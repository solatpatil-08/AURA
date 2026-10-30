import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from aura_agent.models.db import SessionModel, MessageModel
from aura_agent.models.schemas import SessionSchema, MessageSchema


class ConversationHistoryService:
    """Manages local SQLite conversation sessions and message context."""

    def __init__(self, session_factory):
        self.session_factory = session_factory

    async def get_or_create_session(
        self,
        session_id: Optional[str] = None,
        initial_title: Optional[str] = None,
    ) -> SessionModel:
        """Fetch existing session or create a new session if not found."""
        async with self.session_factory() as db:
            if session_id:
                stmt = select(SessionModel).where(SessionModel.id == session_id)
                result = await db.execute(stmt)
                session = result.scalar_one_or_none()
                if session:
                    return session

            # Create new session
            new_id = session_id or str(uuid.uuid4())
            title = initial_title or f"Conversation {datetime.now(timezone.utc).strftime('%b %d, %H:%M')}"
            new_session = SessionModel(
                id=new_id,
                title=title,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            db.add(new_session)
            await db.commit()
            await db.refresh(new_session)
            return new_session

    async def save_message(
        self,
        session_id: str,
        role: str,
        content: str,
        model: Optional[str] = None,
    ) -> MessageModel:
        """Persist a message to the database and update session timestamp."""
        async with self.session_factory() as db:
            msg = MessageModel(
                id=str(uuid.uuid4()),
                session_id=session_id,
                role=role,
                content=content,
                model=model,
                timestamp=datetime.now(timezone.utc),
            )
            db.add(msg)

            # Update session's updated_at timestamp
            session_stmt = select(SessionModel).where(SessionModel.id == session_id)
            res = await db.execute(session_stmt)
            session = res.scalar_one_or_none()
            if session:
                session.updated_at = datetime.now(timezone.utc)

            await db.commit()
            await db.refresh(msg)
            return msg

    async def get_session_messages(
        self,
        session_id: str,
        limit: int = 50,
    ) -> List[MessageSchema]:
        """Fetch chronological messages for a given session."""
        async with self.session_factory() as db:
            stmt = (
                select(MessageModel)
                .where(MessageModel.session_id == session_id)
                .order_by(MessageModel.timestamp.asc())
                .limit(limit)
            )
            result = await db.execute(stmt)
            messages = result.scalars().all()
            return [
                MessageSchema(
                    id=m.id,
                    session_id=m.session_id,
                    role=m.role,
                    content=m.content,
                    timestamp=m.timestamp.isoformat(),
                    model=m.model,
                )
                for m in messages
            ]

    async def get_all_sessions(self, limit: int = 20) -> List[SessionSchema]:
        """List past conversation sessions with message counts."""
        async with self.session_factory() as db:
            stmt = select(SessionModel).order_by(SessionModel.updated_at.desc()).limit(limit)
            result = await db.execute(stmt)
            sessions = result.scalars().all()

            session_schemas = []
            for s in sessions:
                msg_stmt = select(MessageModel).where(MessageModel.session_id == s.id)
                msg_res = await db.execute(msg_stmt)
                count = len(msg_res.scalars().all())

                session_schemas.append(
                    SessionSchema(
                        id=s.id,
                        title=s.title,
                        created_at=s.created_at.strftime("%Y-%m-%d %H:%M"),
                        updated_at=s.updated_at.strftime("%Y-%m-%d %H:%M"),
                        message_count=count,
                    )
                )
            return session_schemas

    async def delete_session(self, session_id: str) -> bool:
        """Delete a conversation session and all its messages."""
        async with self.session_factory() as db:
            stmt = select(SessionModel).where(SessionModel.id == session_id)
            result = await db.execute(stmt)
            session = result.scalar_one_or_none()
            if session:
                await db.delete(session)
                await db.commit()
                return True
            return False

    async def build_conversation_context(
        self,
        session_id: str,
        new_user_message: str,
        max_turns: int = 10,
    ) -> List[Dict[str, str]]:
        """Construct multi-turn message history for Ollama context."""
        async with self.session_factory() as db:
            stmt = (
                select(MessageModel)
                .where(MessageModel.session_id == session_id)
                .order_by(MessageModel.timestamp.desc())
                .limit(max_turns * 2)
            )
            result = await db.execute(stmt)
            recent_messages = list(reversed(result.scalars().all()))

            context: List[Dict[str, str]] = []
            for msg in recent_messages:
                context.append({"role": msg.role, "content": msg.content})

            # Append the current prompt
            context.append({"role": "user", "content": new_user_message})
            return context
