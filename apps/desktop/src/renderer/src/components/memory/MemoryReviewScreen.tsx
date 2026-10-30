import React, { useState, useEffect, useMemo } from 'react'
import {
  Brain,
  Search,
  Plus,
  Trash2,
  Edit3,
  Pin,
  PinOff,
  Eye,
  Calendar,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
  Database,
  X
} from 'lucide-react'
import { MemoryItem } from '../../types'

export const MemoryReviewScreen: React.FC = () => {
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [filterPinned, setFilterPinned] = useState(false)

  // Edit/Create Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingMemory, setEditingMemory] = useState<MemoryItem | null>(null)
  const [modalCategory, setModalCategory] = useState<string>('preference')
  const [modalKey, setModalKey] = useState('')
  const [modalContent, setModalContent] = useState('')
  const [modalPinned, setModalPinned] = useState(false)
  const [modalRetentionDays, setModalRetentionDays] = useState<string>('never')
  const [modalError, setModalError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Clear All confirmation state
  const [isClearModalOpen, setIsClearModalOpen] = useState(false)
  const [clearTargetCategory, setClearTargetCategory] = useState<string>('all')

  const fetchMemories = async () => {
    setLoading(true)
    try {
      const res = await fetch('http://127.0.0.1:8000/api/memory')
      if (res.ok) {
        const data = await res.json()
        setMemories(data)
      }
    } catch (err) {
      console.error('Failed to fetch memories:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMemories()
  }, [])

  const handleOpenCreateModal = () => {
    setEditingMemory(null)
    setModalCategory('preference')
    setModalKey('')
    setModalContent('')
    setModalPinned(false)
    setModalRetentionDays('never')
    setModalError(null)
    setIsModalOpen(true)
  }

  const handleOpenEditModal = (mem: MemoryItem) => {
    setEditingMemory(mem)
    setModalCategory(mem.category)
    setModalKey(mem.key || '')
    setModalContent(mem.content)
    setModalPinned(mem.is_pinned)
    setModalRetentionDays(mem.expires_at ? '30' : 'never')
    setModalError(null)
    setIsModalOpen(true)
  }

  const handleSaveMemory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modalContent.trim()) {
      setModalError('Memory content cannot be empty.')
      return
    }

    setIsSaving(true)
    setModalError(null)

    const payload: Record<string, unknown> = {
      category: modalCategory,
      key: modalKey.trim() || null,
      content: modalContent.trim(),
      is_pinned: modalPinned,
      expires_in_days: modalRetentionDays === 'never' ? null : parseInt(modalRetentionDays, 10)
    }

    try {
      let res: Response
      if (editingMemory) {
        res = await fetch(`http://127.0.0.1:8000/api/memory/${editingMemory.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      } else {
        res = await fetch('http://127.0.0.1:8000/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      }

      if (res.ok) {
        setIsModalOpen(false)
        await fetchMemories()
      } else {
        const errData = await res.json()
        setModalError(errData.detail || 'Failed to save memory.')
      }
    } catch (err) {
      setModalError(`Connection error: ${err}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteMemory = async (id: string) => {
    if (!window.confirm('Delete this memory? AURA will no longer remember this information.')) {
      return
    }

    try {
      const res = await fetch(`http://127.0.0.1:8000/api/memory/${id}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== id))
      }
    } catch (err) {
      console.error('Failed to delete memory:', err)
    }
  }

  const handleTogglePin = async (mem: MemoryItem) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/memory/${mem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_pinned: !mem.is_pinned })
      })
      if (res.ok) {
        setMemories((prev) =>
          prev.map((m) => (m.id === mem.id ? { ...m, is_pinned: !m.is_pinned } : m))
        )
      }
    } catch (err) {
      console.error('Failed to toggle pin:', err)
    }
  }

  const handleConfirmClearAll = async () => {
    try {
      const categoryParam = clearTargetCategory === 'all' ? null : clearTargetCategory
      const res = await fetch('http://127.0.0.1:8000/api/memory/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: categoryParam, confirm: true })
      })
      if (res.ok) {
        setIsClearModalOpen(false)
        await fetchMemories()
      }
    } catch (err) {
      console.error('Failed to clear memories:', err)
    }
  }

  const handleRetentionCleanup = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/memory/retention/cleanup', {
        method: 'POST'
      })
      if (res.ok) {
        await fetchMemories()
      }
    } catch (err) {
      console.error('Failed to run cleanup:', err)
    }
  }

  const filteredMemories = useMemo(() => {
    return memories.filter((mem) => {
      const matchesCategory = selectedCategory === 'all' || mem.category === selectedCategory
      const matchesPinned = !filterPinned || mem.is_pinned
      const q = searchQuery.toLowerCase().trim()
      const matchesQuery =
        !q ||
        mem.content.toLowerCase().includes(q) ||
        (mem.key && mem.key.toLowerCase().includes(q)) ||
        mem.category.toLowerCase().includes(q)
      return matchesCategory && matchesPinned && matchesQuery
    })
  }, [memories, selectedCategory, filterPinned, searchQuery])

  const categoryColor = (cat: string) => {
    switch (cat) {
      case 'preference':
        return { bg: 'rgba(0, 242, 254, 0.12)', border: 'rgba(0, 242, 254, 0.3)', text: 'var(--accent-cyan)' }
      case 'fact':
        return { bg: 'rgba(127, 90, 240, 0.12)', border: 'rgba(127, 90, 240, 0.3)', text: 'var(--accent-purple)' }
      case 'project':
        return { bg: 'rgba(44, 182, 125, 0.12)', border: 'rgba(44, 182, 125, 0.3)', text: '#2cb67d' }
      case 'instruction':
        return { bg: 'rgba(255, 179, 0, 0.12)', border: 'rgba(255, 179, 0, 0.3)', text: '#ffb300' }
      default:
        return { bg: 'rgba(255, 255, 255, 0.08)', border: 'rgba(255, 255, 255, 0.15)', text: 'var(--text-secondary)' }
    }
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--bg-app)',
        padding: '24px',
        gap: '20px'
      }}
    >
      {/* Screen Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.2), rgba(127, 90, 240, 0.2))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-cyan)',
                border: '1px solid var(--border-accent)'
              }}
            >
              <Brain style={{ width: '20px', height: '20px' }} />
            </div>
            <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Persistent Local Memory
            </h1>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '12px',
                background: 'rgba(44, 182, 125, 0.15)',
                color: '#2cb67d',
                border: '1px solid rgba(44, 182, 125, 0.3)',
                fontWeight: 500
              }}
            >
              Local SQLite Store
            </span>
          </div>
          <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            Review, correct, and manage persistent facts and preferences AURA recalls across sessions.
          </p>
        </div>

        {/* Global Memory Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={fetchMemories}
            title="Refresh memory store"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            <RefreshCw style={{ width: '14px', height: '14px' }} />
            Refresh
          </button>

          <button
            type="button"
            onClick={handleRetentionCleanup}
            title="Purge expired memories"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            <Calendar style={{ width: '14px', height: '14px' }} />
            Retention Cleanup
          </button>

          <button
            type="button"
            onClick={() => {
              setClearTargetCategory(selectedCategory)
              setIsClearModalOpen(true)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#ef4444',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            <Trash2 style={{ width: '14px', height: '14px' }} />
            Clear Data
          </button>

          <button
            type="button"
            onClick={handleOpenCreateModal}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))',
              border: 'none',
              color: '#07090e',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 0 12px var(--accent-cyan-glow)'
            }}
          >
            <Plus style={{ width: '15px', height: '15px' }} />
            Add Memory
          </button>
        </div>
      </div>

      {/* Storage Information & Privacy Notice */}
      <div
        style={{
          background: 'rgba(18, 22, 34, 0.6)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px',
          color: 'var(--text-secondary)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Database style={{ width: '16px', height: '16px', color: 'var(--accent-cyan)' }} />
          <span>
            <strong>Storage Location:</strong> Local SQLite database (<code style={{ color: 'var(--accent-cyan)' }}>aura_conversations.db</code>).
          </span>
          <span>•</span>
          <span>
            <strong>Selective Retrieval:</strong> Only top 3 task-relevant memories are injected into prompts.
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ffb300' }}>
          <ShieldAlert style={{ width: '14px', height: '14px' }} />
          <span>Credential protection: Passwords & API tokens are blocked from storage.</span>
        </div>
      </div>

      {/* Search & Category Filter Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <Search
            style={{
              position: 'absolute',
              left: '12px',
              width: '16px',
              height: '16px',
              color: 'var(--text-muted)'
            }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search stored memories by content or topic key..."
            style={{
              width: '100%',
              padding: '9px 12px 9px 36px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none'
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '10px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer'
              }}
            >
              <X style={{ width: '14px', height: '14px' }} />
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {['all', 'preference', 'fact', 'project', 'instruction', 'general'].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                textTransform: 'capitalize',
                cursor: 'pointer',
                background: selectedCategory === cat ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                border: selectedCategory === cat ? '1px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                color: selectedCategory === cat ? 'var(--accent-cyan)' : 'var(--text-secondary)'
              }}
            >
              {cat}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setFilterPinned(!filterPinned)}
            title="Filter pinned memories"
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              background: filterPinned ? 'rgba(127, 90, 240, 0.18)' : 'rgba(255, 255, 255, 0.04)',
              border: filterPinned ? '1px solid var(--accent-purple)' : '1px solid var(--border-subtle)',
              color: filterPinned ? 'var(--accent-purple)' : 'var(--text-secondary)'
            }}
          >
            <Pin style={{ width: '12px', height: '12px' }} />
            Pinned
          </button>
        </div>
      </div>

      {/* Memory Cards Grid */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: '16px',
          alignContent: 'flex-start'
        }}
      >
        {loading ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            Loading persistent memories...
          </div>
        ) : filteredMemories.length === 0 ? (
          <div
            style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: '60px 20px',
              background: 'rgba(18, 22, 34, 0.4)',
              borderRadius: '12px',
              border: '1px dashed var(--border-subtle)',
              color: 'var(--text-muted)'
            }}
          >
            <Brain style={{ width: '36px', height: '36px', margin: '0 auto 12px auto', opacity: 0.4 }} />
            <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)' }}>
              No persistent memories found
            </div>
            <p style={{ fontSize: '13px', margin: '6px auto 16px auto', maxWidth: '380px' }}>
              AURA does not automatically save conversations as permanent memory. Add a memory manually or instruct AURA during conversation.
            </p>
            <button
              type="button"
              onClick={handleOpenCreateModal}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                background: 'rgba(0, 242, 254, 0.15)',
                border: '1px solid var(--accent-cyan)',
                color: 'var(--accent-cyan)',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              Add First Memory
            </button>
          </div>
        ) : (
          filteredMemories.map((mem) => {
            const colors = categoryColor(mem.category)
            return (
              <div
                key={mem.id}
                style={{
                  background: 'rgba(18, 22, 34, 0.75)',
                  border: mem.is_pinned ? '1px solid var(--border-accent)' : '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: mem.is_pinned ? '0 0 15px rgba(0, 242, 254, 0.08)' : 'none',
                  transition: 'border-color 150ms ease'
                }}
              >
                {/* Card Header: Category & Key & Pin */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        background: colors.bg,
                        border: `1px solid ${colors.border}`,
                        color: colors.text
                      }}
                    >
                      {mem.category}
                    </span>

                    {mem.key && (
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          fontFamily: 'monospace',
                          background: 'rgba(255, 255, 255, 0.04)',
                          padding: '2px 6px',
                          borderRadius: '4px'
                        }}
                      >
                        {mem.key}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => handleTogglePin(mem)}
                      title={mem.is_pinned ? 'Unpin memory' : 'Pin memory'}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: mem.is_pinned ? 'var(--accent-cyan)' : 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '4px'
                      }}
                    >
                      {mem.is_pinned ? <Pin style={{ width: '14px', height: '14px' }} /> : <PinOff style={{ width: '14px', height: '14px' }} />}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(mem)}
                      title="Edit / Correct memory"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '4px'
                      }}
                    >
                      <Edit3 style={{ width: '14px', height: '14px' }} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteMemory(mem.id)}
                      title="Delete memory"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '4px'
                      }}
                    >
                      <Trash2 style={{ width: '14px', height: '14px' }} />
                    </button>
                  </div>
                </div>

                {/* Content Text */}
                <div
                  style={{
                    fontSize: '13px',
                    lineHeight: '1.5',
                    color: 'var(--text-primary)',
                    flex: 1,
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {mem.content}
                </div>

                {/* Card Meta / Telemetry Footer */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                    paddingTop: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span title="Retrieval frequency in prompt inferences" style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Eye style={{ width: '12px', height: '12px' }} />
                      {mem.access_count} recall{mem.access_count === 1 ? '' : 's'}
                    </span>
                    {mem.expires_at && (
                      <span style={{ color: '#ffb300' }} title={`Expires on: ${mem.expires_at}`}>
                        Expiring
                      </span>
                    )}
                  </div>

                  <span>Updated {new Date(mem.updated_at).toLocaleDateString()}</span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Add / Edit Memory Modal */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            style={{
              width: '520px',
              maxWidth: '90vw',
              background: '#0d111a',
              border: '1px solid var(--border-accent)',
              borderRadius: '14px',
              padding: '24px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {editingMemory ? 'Correct Memory' : 'Create Persistent Memory'}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X style={{ width: '18px', height: '18px' }} />
              </button>
            </div>

            {/* Secret Policy Notice */}
            <div
              style={{
                background: 'rgba(255, 179, 0, 0.1)',
                border: '1px solid rgba(255, 179, 0, 0.25)',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '12px',
                color: '#ffb300',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <AlertTriangle style={{ width: '16px', height: '16px', flexShrink: 0 }} />
              <span>Never store passwords, authentication tokens, API keys, or private keys in persistent memory.</span>
            </div>

            {modalError && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '12px',
                  color: '#ef4444'
                }}
              >
                {modalError}
              </div>
            )}

            <form onSubmit={handleSaveMemory} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Category
                  </label>
                  <select
                    value={modalCategory}
                    onChange={(e) => setModalCategory(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '13px'
                    }}
                  >
                    <option value="preference">Preference (Coding style, tools)</option>
                    <option value="fact">Fact (Name, role, environment)</option>
                    <option value="project">Project (Repo structure, paths)</option>
                    <option value="instruction">Instruction (Workflow rule)</option>
                    <option value="general">General</option>
                  </select>
                </div>

                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Topic Key (Optional)
                  </label>
                  <input
                    type="text"
                    value={modalKey}
                    onChange={(e) => setModalKey(e.target.value)}
                    placeholder="e.g. coding_style"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '13px'
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Memory Content
                </label>
                <textarea
                  value={modalContent}
                  onChange={(e) => setModalContent(e.target.value)}
                  rows={4}
                  placeholder="State the preference, instruction, or verified fact clearly..."
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    lineHeight: '1.4',
                    resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={modalPinned}
                    onChange={(e) => setModalPinned(e.target.checked)}
                  />
                  <span>Pin Memory (Never expires)</span>
                </label>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Retention:</span>
                  <select
                    value={modalRetentionDays}
                    onChange={(e) => setModalRetentionDays(e.target.value)}
                    disabled={modalPinned}
                    style={{
                      padding: '4px 8px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      color: modalPinned ? 'var(--text-muted)' : 'var(--text-primary)',
                      fontSize: '12px'
                    }}
                  >
                    <option value="never">Never expire</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    background: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))',
                    border: 'none',
                    color: '#07090e',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {isSaving ? 'Saving...' : editingMemory ? 'Save Changes' : 'Store Memory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clear All Confirmation Modal */}
      {isClearModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            style={{
              width: '440px',
              maxWidth: '90vw',
              background: '#0d111a',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '14px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#ef4444' }}>
              <AlertTriangle style={{ width: '24px', height: '24px' }} />
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
                Clear Persistent Memory
              </h2>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              Are you sure you want to delete {clearTargetCategory === 'all' ? 'ALL memories' : `all '${clearTargetCategory}' memories`}? This action is permanent and cannot be undone.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setIsClearModalOpen(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearAll}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  background: '#ef4444',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
