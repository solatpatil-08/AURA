import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryReviewScreen } from '../src/renderer/src/components/memory/MemoryReviewScreen'

describe('AURA Phase 7: Persistent Local Memory Review Screen', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders memory review screen header and storage information', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => []
    } as Response)

    render(<MemoryReviewScreen />)

    expect(screen.getByText('Persistent Local Memory')).toBeDefined()
    expect(screen.getByText('Local SQLite Store')).toBeDefined()
    expect(screen.getByText(/Storage Location:/i)).toBeDefined()
    expect(screen.getByText(/aura_conversations.db/i)).toBeDefined()
    expect(screen.getByText(/Selective Retrieval:/i)).toBeDefined()
  })

  it('displays empty state and opens Create Memory modal on button click', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => []
    } as Response)

    render(<MemoryReviewScreen />)

    await waitFor(() => {
      expect(screen.getByText('No persistent memories found')).toBeDefined()
    })

    const addBtn = screen.getByRole('button', { name: /Add Memory/i })
    fireEvent.click(addBtn)

    expect(screen.getByText('Create Persistent Memory')).toBeDefined()
    expect(screen.getByText(/Never store passwords, authentication tokens/i)).toBeDefined()
    expect(screen.getByPlaceholderText(/State the preference, instruction/i)).toBeDefined()
  })

  it('renders existing memory cards with category badges and keys', async () => {
    const mockMemories = [
      {
        id: 'mem-1',
        category: 'preference',
        key: 'coding_style',
        content: 'User prefers TypeScript with strict types and arrow functions.',
        confidence: 1.0,
        access_count: 5,
        created_at: '2026-10-25T00:00:00Z',
        updated_at: '2026-10-25T00:00:00Z',
        is_pinned: true,
      },
      {
        id: 'mem-2',
        category: 'fact',
        key: 'name',
        content: 'User name is Alice.',
        confidence: 1.0,
        access_count: 2,
        created_at: '2026-10-25T00:00:00Z',
        updated_at: '2026-10-25T00:00:00Z',
        is_pinned: false,
      }
    ]

    vi.spyOn(window, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockMemories
    } as Response)

    render(<MemoryReviewScreen />)

    await waitFor(() => {
      expect(screen.getByText('coding_style')).toBeDefined()
      expect(screen.getByText('User prefers TypeScript with strict types and arrow functions.')).toBeDefined()
      expect(screen.getByText('User name is Alice.')).toBeDefined()
      expect(screen.getByText('5 recalls')).toBeDefined()
      expect(screen.getByText('2 recalls')).toBeDefined()
    })
  })

  it('filters memories when searching in search input', async () => {
    const mockMemories = [
      {
        id: 'mem-1',
        category: 'preference',
        key: 'editor',
        content: 'User prefers VS Code as default editor.',
        confidence: 1.0,
        access_count: 1,
        created_at: '2026-10-25T00:00:00Z',
        updated_at: '2026-10-25T00:00:00Z',
        is_pinned: false,
      },
      {
        id: 'mem-2',
        category: 'fact',
        key: 'os',
        content: 'Host machine runs Windows 11 Pro.',
        confidence: 1.0,
        access_count: 1,
        created_at: '2026-10-25T00:00:00Z',
        updated_at: '2026-10-25T00:00:00Z',
        is_pinned: false,
      }
    ]

    vi.spyOn(window, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockMemories
    } as Response)

    render(<MemoryReviewScreen />)

    await waitFor(() => {
      expect(screen.getByText('User prefers VS Code as default editor.')).toBeDefined()
      expect(screen.getByText('Host machine runs Windows 11 Pro.')).toBeDefined()
    })

    const searchInput = screen.getByPlaceholderText(/Search stored memories/i)
    fireEvent.change(searchInput, { target: { value: 'VS Code' } })

    expect(screen.getByText('User prefers VS Code as default editor.')).toBeDefined()
    expect(screen.queryByText('Host machine runs Windows 11 Pro.')).toBeNull()
  })
})
