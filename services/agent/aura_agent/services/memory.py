import logging
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from sqlalchemy import select, delete, update, func, or_, and_, desc
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
from aura_agent.config import settings
from aura_agent.models.db import MemoryModel

logger = logging.getLogger("aura.memory")

# Stop words to filter during tokenized relevance scoring
STOP_WORDS: Set[str] = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
    "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
    "but", "by", "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
    "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had",
    "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "her", "here", "hers", "herself",
    "him", "himself", "his", "how", "i", "if", "in", "into", "is", "isn't", "it", "it's", "its",
    "itself", "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of",
    "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over",
    "own", "same", "shan't", "she", "should", "shouldn't", "so", "some", "such", "than", "that",
    "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they", "this",
    "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "were",
    "weren't", "what", "when", "where", "which", "while", "who", "whom", "why", "with", "won't",
    "would", "wouldn't", "you", "your", "yours", "yourself", "yourselves",
}

# Regex patterns detecting secrets, keys, and credentials
PROHIBITED_SECRET_PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----", re.IGNORECASE),
    re.compile(r"eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}", re.IGNORECASE),
    re.compile(r"\b(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9a-zA-Z]{10,})\b"),
    re.compile(r"(?i)\b(?:password|passwd|secret_key|api_key|access_token|auth_token)\s*[:=]\s*\S+"),
]


class MemorySecurityError(ValueError):
    """Raised when memory content contains prohibited credentials or secrets."""
    pass


class MemoryService:
    """Manages persistent structured local memory with selective relevance retrieval."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self.session_factory = session_factory

    @staticmethod
    def validate_content_safety(content: str, key: Optional[str] = None):
        """Ensure memory does not contain passwords, authentication tokens, or private keys."""
        text_to_check = f"{key or ''} {content}"
        for pattern in PROHIBITED_SECRET_PATTERNS:
            if pattern.search(text_to_check):
                raise MemorySecurityError(
                    "Storing passwords, authentication tokens, API keys, or private keys in "
                    "persistent memory is strictly prohibited for security."
                )

    @staticmethod
    def tokenize(text: str) -> List[str]:
        """Normalize text into lowercased search tokens, filtering stop words and punctuation."""
        normalized = text.replace("_", " ").replace("-", " ").lower()
        words = re.findall(r"\b[a-zA-Z0-9]{2,}\b", normalized)
        return [w for w in words if w not in STOP_WORDS]

    async def create_memory(
        self,
        category: str,
        content: str,
        key: Optional[str] = None,
        source_session_id: Optional[str] = None,
        confidence: float = 1.0,
        is_pinned: bool = False,
        expires_in_days: Optional[int] = None,
        metadata_json: Optional[str] = None,
    ) -> MemoryModel:
        """Create a new validated persistent memory entry in SQLite."""
        self.validate_content_safety(content, key)

        now = datetime.now(timezone.utc)
        expires_at = None
        days = expires_in_days if expires_in_days is not None else settings.memory_default_retention_days
        if days and not is_pinned:
            expires_at = now + timedelta(days=days)

        memory = MemoryModel(
            category=category.strip().lower(),
            key=key.strip() if key else None,
            content=content.strip(),
            source_session_id=source_session_id,
            confidence=max(0.0, min(1.0, confidence)),
            is_pinned=is_pinned,
            expires_at=expires_at,
            metadata_json=metadata_json,
            created_at=now,
            updated_at=now,
        )

        async with self.session_factory() as session:
            session.add(memory)
            await session.commit()
            await session.refresh(memory)
            logger.info("Created persistent memory [%s:%s] ID: %s", memory.category, memory.key, memory.id)
            return memory

    async def get_memory(self, memory_id: str) -> Optional[MemoryModel]:
        """Retrieve an individual memory entry by ID."""
        async with self.session_factory() as session:
            stmt = select(MemoryModel).where(MemoryModel.id == memory_id)
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def list_memories(
        self,
        category: Optional[str] = None,
        query: Optional[str] = None,
        is_pinned: Optional[bool] = None,
        include_expired: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> List[MemoryModel]:
        """List stored memories with filtering, pagination, and expiration checks."""
        async with self.session_factory() as session:
            stmt = select(MemoryModel)
            conditions = []

            if not include_expired:
                now = datetime.now(timezone.utc)
                conditions.append(or_(MemoryModel.expires_at.is_(None), MemoryModel.expires_at > now))

            if category:
                conditions.append(MemoryModel.category == category.strip().lower())

            if is_pinned is not None:
                conditions.append(MemoryModel.is_pinned == is_pinned)

            if query:
                q_term = f"%{query.strip().lower()}%"
                conditions.append(
                    or_(
                        func.lower(MemoryModel.content).like(q_term),
                        func.lower(MemoryModel.key).like(q_term),
                        func.lower(MemoryModel.category).like(q_term),
                    )
                )

            if conditions:
                stmt = stmt.where(and_(*conditions))

            stmt = stmt.order_by(desc(MemoryModel.is_pinned), desc(MemoryModel.updated_at))
            stmt = stmt.offset(offset).limit(limit)

            result = await session.execute(stmt)
            return list(result.scalars().all())

    async def update_memory(
        self,
        memory_id: str,
        category: Optional[str] = None,
        key: Optional[str] = None,
        content: Optional[str] = None,
        confidence: Optional[float] = None,
        is_pinned: Optional[bool] = None,
        expires_in_days: Optional[int] = None,
    ) -> Optional[MemoryModel]:
        """Update and correct an existing memory record."""
        async with self.session_factory() as session:
            stmt = select(MemoryModel).where(MemoryModel.id == memory_id)
            result = await session.execute(stmt)
            memory = result.scalar_one_or_none()
            if not memory:
                return None

            new_content = content.strip() if content is not None else memory.content
            new_key = key.strip() if key is not None else memory.key
            self.validate_content_safety(new_content, new_key)

            if category is not None:
                memory.category = category.strip().lower()
            if key is not None:
                memory.key = new_key
            if content is not None:
                memory.content = new_content
            if confidence is not None:
                memory.confidence = max(0.0, min(1.0, confidence))
            if is_pinned is not None:
                memory.is_pinned = is_pinned

            now = datetime.now(timezone.utc)
            if expires_in_days is not None:
                if memory.is_pinned:
                    memory.expires_at = None
                else:
                    memory.expires_at = now + timedelta(days=expires_in_days)
            elif is_pinned is True:
                memory.expires_at = None

            memory.updated_at = now

            await session.commit()
            await session.refresh(memory)
            logger.info("Updated persistent memory %s", memory.id)
            return memory

    async def delete_memory(self, memory_id: str) -> bool:
        """Delete a single memory item by ID."""
        async with self.session_factory() as session:
            stmt = delete(MemoryModel).where(MemoryModel.id == memory_id)
            result = await session.execute(stmt)
            await session.commit()
            deleted = result.rowcount > 0
            if deleted:
                logger.info("Deleted memory item %s", memory_id)
            return deleted

    async def clear_memories(self, category: Optional[str] = None) -> int:
        """Clear all memories or all memories in a given category."""
        async with self.session_factory() as session:
            stmt = delete(MemoryModel)
            if category:
                stmt = stmt.where(MemoryModel.category == category.strip().lower())
            result = await session.execute(stmt)
            await session.commit()
            count = result.rowcount or 0
            logger.info("Cleared %d memories (category filter: %s)", count, category)
            return count

    async def apply_retention_policy(self) -> int:
        """Purge all expired, unpinned memories from SQLite."""
        now = datetime.now(timezone.utc)
        async with self.session_factory() as session:
            stmt = delete(MemoryModel).where(
                and_(
                    MemoryModel.is_pinned == False,
                    MemoryModel.expires_at.is_not(None),
                    MemoryModel.expires_at <= now,
                )
            )
            result = await session.execute(stmt)
            await session.commit()
            count = result.rowcount or 0
            if count > 0:
                logger.info("Purged %d expired memories under retention policy", count)
            return count

    async def search_relevant_memories(
        self,
        query: str,
        limit: int = 3,
        category: Optional[str] = None,
        threshold: Optional[float] = None,
    ) -> List[Tuple[MemoryModel, float]]:
        """Retrieve only the top relevant memories for a prompt using scored relevance matching.
        
        Avoids injecting the entire database. Excludes expired memories.
        """
        if not query or not query.strip():
            return []

        min_score = threshold if threshold is not None else settings.memory_relevance_threshold
        query_text = query.strip().lower()
        query_tokens = set(self.tokenize(query_text))

        # 1. Fetch active, non-expired memories
        now = datetime.now(timezone.utc)
        async with self.session_factory() as session:
            stmt = select(MemoryModel).where(
                or_(MemoryModel.expires_at.is_(None), MemoryModel.expires_at > now)
            )
            if category:
                stmt = stmt.where(MemoryModel.category == category.strip().lower())

            result = await session.execute(stmt)
            all_active = list(result.scalars().all())

        if not all_active:
            return []

        # 2. Score relevance for each memory
        scored_candidates: List[Tuple[MemoryModel, float]] = []

        for mem in all_active:
            content_lower = mem.content.lower()
            key_lower = (mem.key or "").lower()
            cat_lower = mem.category.lower()

            content_tokens = set(self.tokenize(content_lower))
            key_tokens = set(self.tokenize(key_lower))

            score = 0.0

            # Exact phrase match in content or key
            if query_text in content_lower:
                score += 0.6
            elif any(len(phrase) > 5 and phrase in content_lower for phrase in query_text.split(" and ")):
                score += 0.4

            # Token overlap in content
            if query_tokens and content_tokens:
                overlap = len(query_tokens & content_tokens)
                overlap_ratio = overlap / max(len(query_tokens), 1)
                score += overlap_ratio * 0.5

            # Token overlap in key
            if query_tokens and key_tokens:
                key_overlap = len(query_tokens & key_tokens)
                score += (key_overlap / max(len(query_tokens), 1)) * 0.4

            # Category query match
            if cat_lower in query_tokens:
                score += 0.2

            # Only consider memory if there is an actual topical match with the query
            if score <= 0.0:
                continue

            # Pinned bonus (user explicitly marked this high-priority)
            if mem.is_pinned:
                score += 0.2

            # Recency bonus (created or accessed in last 7 days)
            last_activity = mem.last_accessed_at or mem.created_at
            if last_activity and (now - last_activity.replace(tzinfo=timezone.utc if last_activity.tzinfo is None else None)).days < 7:
                score += 0.1

            # Multiply by confidence
            final_score = round(score * mem.confidence, 4)

            if final_score >= min_score:
                scored_candidates.append((mem, final_score))

        # 3. Sort by score descending and take top K limit
        scored_candidates.sort(key=lambda x: x[1], reverse=True)
        top_candidates = scored_candidates[:limit]

        # 4. Update access statistics for retrieved memories
        if top_candidates:
            top_ids = [mem.id for mem, _ in top_candidates]
            for mem, _ in top_candidates:
                mem.access_count += 1
                mem.last_accessed_at = now

            async with self.session_factory() as session:
                update_stmt = (
                    update(MemoryModel)
                    .where(MemoryModel.id.in_(top_ids))
                    .values(
                        access_count=MemoryModel.access_count + 1,
                        last_accessed_at=now,
                    )
                )
                await session.execute(update_stmt)
                await session.commit()

        return top_candidates

    @staticmethod
    def format_relevant_memories_prompt(hits: List[Tuple[MemoryModel, float]]) -> str:
        """Format retrieved memories into a compact context block for the local Ollama prompt."""
        if not hits:
            return ""

        lines = [
            "RELEVANT USER MEMORIES (Retrieved from local persistent storage):",
            "Use these factual preferences and details when crafting your answer:",
        ]
        for mem, _ in hits:
            tag = f"[{mem.category}:{mem.key}]" if mem.key else f"[{mem.category}]"
            lines.append(f"- {tag} {mem.content}")

        lines.append("")
        return "\n".join(lines)
