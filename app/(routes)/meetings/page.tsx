'use client'

import type { KeyboardEvent } from 'react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { browserClient } from '@/lib/supabase/browser'
import { getAccessToken } from '@/lib/supabase/auth'
import { getMeetingRole, canPin, canEdit, canDelete, canManageShares } from '@/lib/access/roles'
import type { Meeting, MeetingStatus, FolderWithRole, FolderShareMember } from '@/types/database'

type LoadState = 'loading' | 'ready' | 'error'

const POLL_INTERVAL_MS = 3_000
const IN_FLIGHT: MeetingStatus[] = ['pending', 'processing']

function sortMeetings(list: Meeting[]): Meeting[] {
  return [...list].sort((a, b) => {
    if (a.pinned_at && b.pinned_at) {
      return new Date(b.pinned_at).getTime() - new Date(a.pinned_at).getTime()
    }
    if (a.pinned_at) return -1
    if (b.pinned_at) return 1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function StatusBadge({ status }: { status: MeetingStatus }) {
  const cls: Record<MeetingStatus, string> = {
    pending:    'badge-pending',
    processing: 'badge-processing',
    done:       'badge-done',
    failed:     'badge-failed',
  }
  return <span className={cls[status]}>{status}</span>
}

export default function MeetingsPage() {
  // ── meeting list state ─────────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loadState, setLoadState]     = useState<LoadState>('loading')
  const [meetings, setMeetings]       = useState<Meeting[]>([])
  const [loadError, setLoadError]     = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionWarning, setActionWarning] = useState<string | null>(null)
  const [busyId, setBusyId]           = useState<string | null>(null)
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editTitle, setEditTitle]     = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const folderScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft]   = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  // ── folder state ───────────────────────────────────────────────────────────
  const [folders, setFolders]           = useState<FolderWithRole[]>([])
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([])
  const [manageFoldersOpen, setManageFoldersOpen]   = useState(false)
  const [newFolderName, setNewFolderName]   = useState('')
  const [newFolderError, setNewFolderError] = useState<string | null>(null)
  const [newFolderBusy, setNewFolderBusy]   = useState(false)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderTitle, setRenameFolderTitle] = useState('')
  const [renameFolderError, setRenameFolderError] = useState<string | null>(null)
  const [folderBusy, setFolderBusy] = useState<string | null>(null)
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null)
  const [movingMeetingId, setMovingMeetingId] = useState<string | null>(null)
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // ── share panel state ──────────────────────────────────────────────────────
  const [sharingFolderId, setSharingFolderId]     = useState<string | null>(null)
  const [shareMembers, setShareMembers]           = useState<FolderShareMember[]>([])
  const [shareBusy, setShareBusy]                 = useState(false)
  const [shareError, setShareError]               = useState<string | null>(null)
  const [addShareIdentifier, setAddShareIdentifier] = useState('')
  const [addShareRole, setAddShareRole]           = useState<'editor' | 'viewer'>('viewer')
  const [addShareBusy, setAddShareBusy]           = useState(false)
  const [addShareError, setAddShareError]         = useState<string | null>(null)

  // ── load current user ──────────────────────────────────────────────────────
  useEffect(() => {
    browserClient.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null)
    })
  }, [])

  // ── load meetings ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function load(silent = false) {
      try {
        const { data, error: dbError } = await browserClient
          .from('meetings')
          .select('*')
          .order('created_at', { ascending: false })

        if (cancelled) return
        if (dbError) throw new Error(dbError.message)
        const rows = sortMeetings((data as Meeting[]) ?? [])
        setMeetings(rows)
        if (!silent) setLoadState('ready')

        if (rows.some((m) => IN_FLIGHT.includes(m.status))) {
          pollRef.current = setTimeout(() => { void load(true) }, POLL_INTERVAL_MS)
        }
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load meetings.')
        setLoadState('error')
      }
    }

    void load()
    return () => {
      cancelled = true
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [])

  // ── load folders (owned + shared) ─────────────────────────────────────────
  useEffect(() => {
    async function loadFolders() {
      const token = await getAccessToken()
      if (!token) return
      try {
        const res = await fetch('/api/folders', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const json = (await res.json()) as { folders: FolderWithRole[] }
        setFolders(json.folders)
      } catch { /* non-fatal */ }
    }
    void loadFolders()
  }, [])

  // ── folder expand/collapse ─────────────────────────────────────────────────
  function toggleFolder(folderId: string) {
    setExpandedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId],
    )
  }

  // ── meeting actions ────────────────────────────────────────────────────────
  async function togglePin(m: Meeting) {
    const token = await getAccessToken()
    if (!token) return
    setActionError(null)
    setBusyId(m.id)

    const newPinnedAt = m.pinned_at ? null : new Date().toISOString()
    setMeetings((prev) => sortMeetings(prev.map((x) => x.id === m.id ? { ...x, pinned_at: newPinnedAt } : x)))

    try {
      const res = await fetch(`/api/meetings/${m.id}/pin`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as { pinned_at?: string | null; error?: string }
      if (!res.ok) {
        setMeetings((prev) => sortMeetings(prev.map((x) => x.id === m.id ? { ...x, pinned_at: m.pinned_at } : x)))
        setActionError(data.error ?? 'Failed to update pin.')
      } else {
        setMeetings((prev) => sortMeetings(prev.map((x) =>
          x.id === m.id ? { ...x, pinned_at: data.pinned_at ?? null } : x,
        )))
      }
    } catch {
      setMeetings((prev) => sortMeetings(prev.map((x) => x.id === m.id ? { ...x, pinned_at: m.pinned_at } : x)))
      setActionError('Network error — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  function startRename(m: Meeting) {
    setEditingId(m.id)
    setEditTitle(m.title)
    setActionError(null)
  }

  async function saveRename(meetingId: string) {
    const trimmed = editTitle.trim()
    if (!trimmed) { setActionError('Title must not be empty.'); return }

    const token = await getAccessToken()
    if (!token) return
    setActionError(null)
    setBusyId(meetingId)

    const prevTitle = meetings.find((m) => m.id === meetingId)?.title ?? ''
    setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, title: trimmed } : x))
    setEditingId(null)

    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: trimmed }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, title: prevTitle } : x))
        setActionError(data.error ?? 'Failed to rename meeting.')
      }
    } catch {
      setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, title: prevTitle } : x))
      setActionError('Network error — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function deleteMeeting(meetingId: string) {
    const token = await getAccessToken()
    if (!token) return
    setActionError(null)
    setActionWarning(null)
    setBusyId(meetingId)
    setConfirmDeleteId(null)

    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as { ok?: boolean; warning?: string; error?: string }
      if (!res.ok) {
        setActionError(data.error ?? 'Failed to delete meeting.')
      } else {
        setMeetings((prev) => prev.filter((x) => x.id !== meetingId))
        if (data.warning) setActionWarning(data.warning)
      }
    } catch {
      setActionError('Network error — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function moveMeeting(meetingId: string, newFolderId: string | null) {
    setMovingMeetingId(null)   // close selector immediately
    const token = await getAccessToken()
    if (!token) return
    setActionError(null)

    const prevFolderId = meetings.find((m) => m.id === meetingId)?.folder_id ?? null
    setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, folder_id: newFolderId } : x))

    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ folder_id: newFolderId }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, folder_id: prevFolderId } : x))
        setActionError(data.error ?? 'Failed to move meeting.')
      }
    } catch {
      setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, folder_id: prevFolderId } : x))
      setActionError('Network error — please try again.')
    }
  }

  // ── folder actions ─────────────────────────────────────────────────────────
  async function createFolder() {
    const name = newFolderName.trim()
    if (!name) return
    const token = await getAccessToken()
    if (!token) return
    setNewFolderBusy(true)
    setNewFolderError(null)

    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      })
      const data = (await res.json()) as { folder?: FolderWithRole; error?: string }
      if (!res.ok) {
        setNewFolderError(data.error ?? 'Failed to create folder.')
      } else if (data.folder) {
        setFolders((prev) => [...prev, data.folder!])
        setNewFolderName('')
      }
    } catch {
      setNewFolderError('Network error — please try again.')
    } finally {
      setNewFolderBusy(false)
    }
  }

  function startRenameFolder(f: FolderWithRole) {
    setRenamingFolderId(f.id)
    setRenameFolderTitle(f.name)
    setRenameFolderError(null)
    setConfirmDeleteFolderId(null)
  }

  async function saveRenameFolder(folderId: string) {
    const name = renameFolderTitle.trim()
    if (!name) { setRenameFolderError('Name must not be empty.'); return }
    const token = await getAccessToken()
    if (!token) return
    setFolderBusy(folderId)
    setRenameFolderError(null)

    const prevName = folders.find((f) => f.id === folderId)?.name ?? ''
    setFolders((prev) => prev.map((f) => f.id === folderId ? { ...f, name } : f))
    setRenamingFolderId(null)

    try {
      const res = await fetch(`/api/folders/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      })
      const data = (await res.json()) as { folder?: FolderWithRole; error?: string }
      if (!res.ok) {
        setFolders((prev) => prev.map((f) => f.id === folderId ? { ...f, name: prevName } : f))
        setRenameFolderError(data.error ?? 'Failed to rename folder.')
        setRenamingFolderId(folderId)
        setRenameFolderTitle(name)
      } else if (data.folder) {
        setFolders((prev) =>
          prev.map((f) => f.id === folderId ? { ...data.folder!, myRole: f.myRole, ownerUsername: f.ownerUsername } : f)
        )
      }
    } catch {
      setFolders((prev) => prev.map((f) => f.id === folderId ? { ...f, name: prevName } : f))
      setRenameFolderError('Network error — please try again.')
      setRenamingFolderId(folderId)
      setRenameFolderTitle(name)
    } finally {
      setFolderBusy(null)
    }
  }

  async function deleteFolder(folderId: string) {
    const token = await getAccessToken()
    if (!token) return
    setFolderBusy(folderId)
    setConfirmDeleteFolderId(null)

    try {
      const res = await fetch(`/api/folders/${folderId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setActionError(data.error ?? 'Failed to delete folder.')
      } else {
        setFolders((prev) => prev.filter((f) => f.id !== folderId))
        setExpandedFolderIds((prev) => prev.filter((id) => id !== folderId))
        setMeetings((prev) => prev.map((m) => m.folder_id === folderId ? { ...m, folder_id: null } : m))
      }
    } catch {
      setActionError('Network error — please try again.')
    } finally {
      setFolderBusy(null)
    }
  }

  // ── share panel actions ────────────────────────────────────────────────────
  async function openSharePanel(folderId: string) {
    setSharingFolderId(folderId)
    setShareMembers([])
    setShareError(null)
    setAddShareIdentifier('')
    setAddShareError(null)
    setShareBusy(true)

    const token = await getAccessToken()
    if (!token) { setShareBusy(false); return }

    try {
      const res = await fetch(`/api/folders/${folderId}/shares`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as { members?: FolderShareMember[]; error?: string }
      if (!res.ok) {
        setShareError(data.error ?? 'Failed to load members.')
      } else {
        setShareMembers(data.members ?? [])
      }
    } catch {
      setShareError('Network error — please try again.')
    } finally {
      setShareBusy(false)
    }
  }

  async function addShareMember() {
    const identifier = addShareIdentifier.trim()
    if (!identifier || !sharingFolderId) return
    const token = await getAccessToken()
    if (!token) return
    setAddShareBusy(true)
    setAddShareError(null)

    try {
      const res = await fetch(`/api/folders/${sharingFolderId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ identifier, role: addShareRole }),
      })
      const data = (await res.json()) as { member?: FolderShareMember; error?: string }
      if (!res.ok) {
        setAddShareError(data.error ?? 'Failed to add member.')
      } else if (data.member) {
        setShareMembers((prev) => [...prev, data.member!])
        setAddShareIdentifier('')
      }
    } catch {
      setAddShareError('Network error — please try again.')
    } finally {
      setAddShareBusy(false)
    }
  }

  async function changeShareRole(userId: string, newRole: 'editor' | 'viewer') {
    if (!sharingFolderId) return
    const token = await getAccessToken()
    if (!token) return

    const prev = shareMembers
    setShareMembers((m) => m.map((x) => x.userId === userId ? { ...x, role: newRole } : x))

    try {
      const res = await fetch(`/api/folders/${sharingFolderId}/shares/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: newRole }),
      })
      if (!res.ok) {
        setShareMembers(prev)
        setShareError('Failed to change role.')
      }
    } catch {
      setShareMembers(prev)
      setShareError('Network error — please try again.')
    }
  }

  async function removeMember(granteeId: string) {
    if (!sharingFolderId) return
    const token = await getAccessToken()
    if (!token) return

    const prev = shareMembers
    setShareMembers((m) => m.filter((x) => x.userId !== granteeId))

    try {
      const res = await fetch(`/api/folders/${sharingFolderId}/shares/${granteeId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setShareMembers(prev)
        setShareError('Failed to remove member.')
      }
    } catch {
      setShareMembers(prev)
      setShareError('Network error — please try again.')
    }
  }

  // ── folder drag-and-drop ───────────────────────────────────────────────────
  async function reorderFolders(reordered: FolderWithRole[]) {
    const token = await getAccessToken()
    if (!token) return
    try {
      await fetch('/api/folders/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ order: reordered.map((f) => f.id) }),
      })
    } catch { /* non-fatal — client state already updated */ }
  }

  function handleFolderDragStart(e: React.DragEvent, idx: number) {
    setDragFromIndex(idx)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleFolderDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== idx) setDragOverIndex(idx)
  }

  function handleFolderDrop(e: React.DragEvent, dropIdx: number) {
    e.preventDefault()
    if (dragFromIndex === null || dragFromIndex === dropIdx) {
      setDragFromIndex(null)
      setDragOverIndex(null)
      return
    }
    const next = [...folders]
    const [moved] = next.splice(dragFromIndex, 1)
    next.splice(dropIdx, 0, moved)
    setFolders(next)
    setDragFromIndex(null)
    setDragOverIndex(null)
    void reorderFolders(next)
  }

  function handleFolderDragEnd() {
    setDragFromIndex(null)
    setDragOverIndex(null)
  }

  // ── folder scroll helpers ──────────────────────────────────────────────────
  function updateScrollButtons() {
    const el = folderScrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  function scrollFolders(dir: 'left' | 'right') {
    folderScrollRef.current?.scrollBy({ left: dir === 'left' ? -240 : 240, behavior: 'smooth' })
  }

  useEffect(() => {
    const id = setTimeout(updateScrollButtons, 60)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders])

  // ── derived ────────────────────────────────────────────────────────────────
  const confirmTarget = confirmDeleteId ? meetings.find((m) => m.id === confirmDeleteId) : null
  const sharingFolder = sharingFolderId ? folders.find((f) => f.id === sharingFolderId) : null
  // Only owned folders appear in the "move to" selector (you can move your meetings there)
  const editableFolders = folders.filter((f) => f.myRole === 'owner' || f.myRole === 'editor')

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Page header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-serif text-4xl font-bold text-b-fg leading-tight">
            Your <em className="italic text-b-terra">Meetings</em>
          </h1>
          <p className="mt-1 text-sm text-b-fg/50 font-sans">
            {meetings.length > 0 ? `${meetings.length} recording${meetings.length === 1 ? '' : 's'}` : 'No recordings yet'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setManageFoldersOpen(true); setNewFolderName(''); setNewFolderError(null); setSharingFolderId(null) }}
            className="px-5 py-2.5 rounded-full border border-b-border text-b-fg text-sm font-semibold uppercase tracking-widest cursor-pointer bg-transparent hover:bg-b-clay transition-all duration-300"
          >
            + New folder
          </button>
          <Link href="/record" className="btn-primary">
            + New recording
          </Link>
        </div>
      </div>

      {/* Folder filter pills */}
      {loadState === 'ready' && (
        <div className="relative flex items-center gap-1 mb-6">
          {canScrollLeft && (
            <button
              onClick={() => scrollFolders('left')}
              aria-label="Scroll folders left"
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full border border-b-border bg-white text-b-fg/60 hover:text-b-fg hover:border-b-fg/40 shadow-b-sm transition-all duration-200 cursor-pointer text-base leading-none"
            >
              ‹
            </button>
          )}

          <div
            ref={folderScrollRef}
            onScroll={updateScrollButtons}
            className="flex-1 flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <button
              onClick={() => setActiveFolderFilter('all')}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 cursor-pointer ${
                activeFolderFilter === 'all'
                  ? 'bg-b-fg text-white border-b-fg'
                  : 'bg-transparent text-b-fg/60 border-b-border hover:border-b-fg/40 hover:text-b-fg'
              }`}
            >
              All ({meetings.length})
            </button>

            <button
              onClick={() => setActiveFolderFilter('uncategorized')}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 cursor-pointer ${
                activeFolderFilter === 'uncategorized'
                  ? 'bg-b-fg text-white border-b-fg'
                  : 'bg-transparent text-b-fg/60 border-b-border hover:border-b-fg/40 hover:text-b-fg'
              }`}
            >
              Uncategorized ({meetings.filter((m) => m.folder_id === null).length})
            </button>

            {folders.map((f, idx) => {
              const count = meetings.filter((m) => m.folder_id === f.id).length
              const isActive = activeFolderFilter === f.id
              const isOwned = f.myRole === 'owner'
              const isDragging = dragFromIndex === idx
              const isDropTarget = dragOverIndex === idx && dragFromIndex !== null && dragFromIndex !== idx
              return (
                <button
                  key={f.id}
                  title={!isOwned ? `${f.name} — shared by @${f.ownerUsername ?? '?'} (${f.myRole})` : f.name}
                  draggable={isOwned}
                  onClick={() => setActiveFolderFilter(f.id)}
                  onDragStart={isOwned ? (e) => handleFolderDragStart(e, idx) : undefined}
                  onDragOver={isOwned ? (e) => handleFolderDragOver(e, idx) : undefined}
                  onDrop={isOwned ? (e) => handleFolderDrop(e, idx) : undefined}
                  onDragEnd={handleFolderDragEnd}
                  className={[
                    'flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 max-w-[180px] truncate select-none',
                    isOwned ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                    isActive
                      ? 'bg-b-primary text-white border-b-primary'
                      : 'bg-transparent text-b-fg/60 border-b-border hover:border-b-primary/40 hover:text-b-fg',
                    isDragging ? 'opacity-40' : '',
                    isDropTarget ? 'ring-2 ring-b-primary/50 border-b-primary' : '',
                  ].join(' ')}
                >
                  {!isOwned ? '👥' : '📁'} {f.name} ({count})
                </button>
              )
            })}

            <button
              onClick={() => { setManageFoldersOpen(true); setRenamingFolderId(null); setConfirmDeleteFolderId(null); setSharingFolderId(null) }}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border border-dashed border-b-border text-b-fg/40 hover:text-b-fg/70 hover:border-b-fg/40 transition-all duration-200 cursor-pointer bg-transparent"
            >
              Manage folders
            </button>
          </div>

          {canScrollRight && (
            <button
              onClick={() => scrollFolders('right')}
              aria-label="Scroll folders right"
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full border border-b-border bg-white text-b-fg/60 hover:text-b-fg hover:border-b-fg/40 shadow-b-sm transition-all duration-200 cursor-pointer text-base leading-none"
            >
              ›
            </button>
          )}
        </div>
      )}

      {/* Banners */}
      {actionError && (
        <div className="banner-error">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="opacity-60 hover:opacity-100 cursor-pointer bg-transparent border-0 text-sm">✕</button>
        </div>
      )}
      {actionWarning && (
        <div className="banner-warning">
          <span>{actionWarning}</span>
          <button onClick={() => setActionWarning(null)} className="opacity-60 hover:opacity-100 cursor-pointer bg-transparent border-0 text-sm">✕</button>
        </div>
      )}

      {/* Loading */}
      {loadState === 'loading' && (
        <div className="flex flex-col gap-3 mt-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-3xl bg-b-clay animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
          ))}
        </div>
      )}

      {/* Error */}
      {loadState === 'error' && (
        <div className="banner-error mt-2">{loadError}</div>
      )}

      {/* Empty state — no meetings at all */}
      {loadState === 'ready' && meetings.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-full bg-b-clay flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🎙</span>
          </div>
          <p className="font-serif text-xl text-b-fg mb-2">No meetings yet</p>
          <p className="text-sm text-b-fg/50 font-sans mb-6">Record your first meeting to get started.</p>
          <Link href="/record" className="btn-primary">
            Record your first meeting
          </Link>
        </div>
      )}

      {/* Empty folder view */}
      {loadState === 'ready' && meetings.length > 0 && filteredMeetings.length === 0 && (
        <div className="text-center py-16">
          <p className="font-serif text-lg text-b-fg/60 mb-2">No meetings in this view</p>
          <button
            onClick={() => setActiveFolderFilter('all')}
            className="text-sm text-b-primary font-sans hover:underline cursor-pointer bg-transparent border-0"
          >
            Show all meetings →
          </button>
        </div>
      )}

      {/* Meeting cards */}
      {loadState === 'ready' && filteredMeetings.length > 0 && (
        <ul className="flex flex-col gap-3">
          {filteredMeetings.map((m) => {
            const folderName = m.folder_id
              ? (folders.find((f) => f.id === m.folder_id)?.name ?? null)
              : null
            const folderIsShared = m.folder_id
              ? (folders.find((f) => f.id === m.folder_id)?.myRole !== 'owner')
              : false
            const isMoving = movingMeetingId === m.id

            // Determine role — needs currentUserId loaded
            const myRole = currentUserId
              ? getMeetingRole({ user_id: m.user_id, folder_id: m.folder_id }, currentUserId, folders)
              : 'viewer'
            const canPinThis    = currentUserId ? canPin({ user_id: m.user_id }, currentUserId) : false
            const canEditThis   = canEdit(myRole)
            const canDeleteThis = canDelete(myRole)

            return (
              <li key={m.id}>
                <div className={[
                  'bg-white rounded-3xl border transition-all duration-300 overflow-hidden',
                  m.pinned_at
                    ? 'border-b-primary/50 shadow-b-md'
                    : 'border-b-border shadow-b-sm hover:shadow-b-md hover:-translate-y-0.5',
                ].join(' ')}>
                  <div className="flex items-start gap-3 px-5 py-4">
                    {/* Pin toggle — owner only */}
                    <button
                      title={m.pinned_at ? 'Unpin' : 'Pin to top'}
                      disabled={busyId === m.id || !canPinThis}
                      onClick={() => { if (canPinThis) void togglePin(m) }}
                      aria-label={m.pinned_at ? 'Unpin meeting' : 'Pin meeting to top'}
                      className={[
                        'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all duration-300 border-0 mt-0.5',
                        m.pinned_at
                          ? 'bg-b-primary/20 text-b-fg cursor-pointer'
                          : canPinThis
                            ? 'bg-transparent text-b-fg/20 hover:text-b-fg/50 hover:bg-b-clay cursor-pointer'
                            : 'bg-transparent text-b-fg/10 cursor-default',
                      ].join(' ')}
                    >
                      📌
                    </button>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      {editingId === m.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-b-clay border border-b-primary text-b-fg text-sm font-semibold outline-none"
                            value={editTitle}
                            maxLength={200}
                            autoFocus
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                              if (e.key === 'Enter') void saveRename(m.id)
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                          />
                          <button
                            disabled={busyId === m.id}
                            onClick={() => { void saveRename(m.id) }}
                            className="px-3 py-1.5 rounded-full bg-b-fg text-white text-xs font-semibold uppercase tracking-widest cursor-pointer border-0 hover:opacity-80 transition-opacity flex-shrink-0"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 rounded-full border border-b-border text-b-fg/60 text-xs font-semibold uppercase tracking-widest cursor-pointer bg-transparent hover:bg-b-clay transition-colors flex-shrink-0"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <Link href={`/meetings/${m.id}`} className="block group">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-sans font-semibold text-sm text-b-fg truncate group-hover:text-b-terra transition-colors duration-300">
                              {m.title}
                            </span>
                            <StatusBadge status={m.status} />
                          </div>
                          <div className="text-xs text-b-fg/40 font-sans">
                            {formatDate(m.created_at)}
                            {m.duration_seconds != null && (
                              <> · {formatDuration(m.duration_seconds)}</>
                            )}
                            {folderName && (
                              <> · <span className="text-b-primary/70">
                                {folderIsShared ? '👥' : '📁'} {folderName}
                              </span></>
                            )}
                            {myRole !== 'owner' && (
                              <span className="ml-1 inline-block px-1.5 py-0.5 rounded bg-b-clay text-b-fg/50 text-[10px] font-semibold uppercase tracking-wider">
                                {myRole}
                              </span>
                            )}
                          </div>
                        </Link>
                      )}

                      {/* Inline move selector */}
                      {isMoving && editingId !== m.id && (
                        <div className="mt-3 flex items-center gap-2">
                          <select
                            defaultValue={m.folder_id ?? ''}
                            onChange={(e) => {
                              const v = e.target.value
                              void moveMeeting(m.id, v === '' ? null : v)
                            }}
                            autoFocus
                            className="flex-1 rounded-xl border border-b-border bg-b-clay px-3 py-1.5 text-sm font-sans text-b-fg focus:outline-none focus:ring-2 focus:ring-b-primary/40 cursor-pointer"
                          >
                            <option value="">Uncategorized</option>
                            {editableFolders.map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => setMovingMeetingId(null)}
                            className="flex-shrink-0 px-3 py-1.5 rounded-xl border border-b-border text-b-fg/60 text-xs cursor-pointer bg-transparent hover:bg-b-clay transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Actions — gated by role */}
                    {editingId !== m.id && !isMoving && (
                      <div className="flex-shrink-0 flex items-center gap-1.5 mt-0.5">
                        {canEditThis && (
                          <button
                            disabled={busyId === m.id}
                            onClick={() => { setMovingMeetingId(m.id); setActionError(null) }}
                            className="px-3 py-1.5 rounded-full border border-b-border text-b-fg/60 text-xs font-semibold uppercase tracking-widest cursor-pointer bg-transparent hover:bg-b-clay hover:text-b-fg transition-all duration-300"
                          >
                            Move
                          </button>
                        )}
                        {canEditThis && (
                          <button
                            disabled={busyId === m.id}
                            onClick={() => startRename(m)}
                            className="px-3 py-1.5 rounded-full border border-b-border text-b-fg/60 text-xs font-semibold uppercase tracking-widest cursor-pointer bg-transparent hover:bg-b-clay hover:text-b-fg transition-all duration-300"
                          >
                            Rename
                          </button>
                        )}
                        {canDeleteThis && (
                          <button
                            disabled={busyId === m.id}
                            onClick={() => setConfirmDeleteId(m.id)}
                            className="px-3 py-1.5 rounded-full border border-red-100 text-red-400 text-xs font-semibold uppercase tracking-widest cursor-pointer bg-transparent hover:bg-red-50 hover:text-red-600 transition-all duration-300"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* ── Delete meeting confirmation dialog ── */}
      {confirmTarget && (
        <div
          className="fixed inset-0 bg-b-fg/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="bg-white rounded-3xl border border-b-border shadow-b-xl p-8 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-serif text-xl font-bold text-b-fg mb-3">
              Delete this meeting?
            </h3>
            <p className="text-sm text-b-fg/60 font-sans leading-relaxed mb-6">
              <strong className="text-b-fg">&ldquo;{confirmTarget.title}&rdquo;</strong>
              <br />
              This permanently deletes the meeting, transcript, todos, and recording. This can&apos;t be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-5 py-2 rounded-full border border-b-border text-b-fg/60 text-sm font-semibold uppercase tracking-widest cursor-pointer bg-transparent hover:bg-b-clay transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={busyId === confirmTarget.id}
                onClick={() => { void deleteMeeting(confirmTarget.id) }}
                className="px-5 py-2 rounded-full bg-red-600 text-white text-sm font-semibold uppercase tracking-widest cursor-pointer border-0 hover:bg-red-700 transition-colors"
                style={{ opacity: busyId === confirmTarget.id ? 0.65 : 1 }}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manage folders modal ── */}
      {manageFoldersOpen && (
        <div
          className="fixed inset-0 bg-b-fg/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => {
            setManageFoldersOpen(false)
            setRenamingFolderId(null)
            setConfirmDeleteFolderId(null)
            setSharingFolderId(null)
          }}
        >
          <div
            className="bg-white rounded-3xl border border-b-border shadow-b-xl p-8 max-w-md w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Share panel (replaces folder list when a folder is being shared) */}
            {sharingFolderId ? (
              <>
                <div className="flex items-center gap-3 mb-6">
                  <button
                    onClick={() => { setSharingFolderId(null); setShareError(null) }}
                    className="text-b-fg/40 hover:text-b-fg text-sm cursor-pointer bg-transparent border-0"
                  >
                    ← Back
                  </button>
                  <h3 className="font-serif text-xl font-bold text-b-fg">
                    Share &ldquo;{sharingFolder?.name}&rdquo;
                  </h3>
                </div>

                {shareError && (
                  <p className="text-xs text-red-500 mb-3">{shareError}</p>
                )}

                {/* Owner row */}
                <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 mb-4">
                  {currentUserId && sharingFolder && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-b-clay/50">
                      <span className="flex-1 text-sm font-semibold text-b-fg truncate">
                        @{folders.find((f) => f.id === sharingFolderId)?.ownerUsername ?? 'You'}
                      </span>
                      <span className="text-xs text-b-fg/40 font-semibold uppercase tracking-wide px-2 py-0.5 rounded border border-b-border">Owner</span>
                    </div>
                  )}

                  {shareBusy && (
                    <p className="text-xs text-b-fg/40 font-sans py-2 text-center animate-pulse">Loading members…</p>
                  )}

                  {!shareBusy && shareMembers.map((member) => (
                    <div key={member.userId} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-b-border">
                      <span className="flex-1 text-sm text-b-fg truncate">@{member.username}</span>
                      <select
                        value={member.role}
                        onChange={(e) => void changeShareRole(member.userId, e.target.value as 'editor' | 'viewer')}
                        className="text-xs border border-b-border rounded-lg px-2 py-1 bg-white text-b-fg focus:outline-none cursor-pointer"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>
                      <button
                        onClick={() => void removeMember(member.userId)}
                        className="text-xs text-red-400 hover:text-red-600 cursor-pointer bg-transparent border-0 px-1"
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  {!shareBusy && shareMembers.length === 0 && (
                    <p className="text-xs text-b-fg/40 font-sans py-2 text-center">No members yet — add someone below.</p>
                  )}
                </div>

                {/* Add member form */}
                <div className="border-t border-b-border pt-4">
                  <p className="text-xs font-semibold text-b-fg/60 font-sans uppercase tracking-wide mb-2">Add member</p>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={addShareIdentifier}
                      onChange={(e) => setAddShareIdentifier(e.target.value)}
                      placeholder="Email or @username"
                      disabled={addShareBusy}
                      className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-b-border bg-b-clay text-sm font-sans text-b-fg focus:outline-none focus:ring-2 focus:ring-b-primary/40 disabled:opacity-50"
                      onKeyDown={(e) => { if (e.key === 'Enter') void addShareMember() }}
                    />
                    <select
                      value={addShareRole}
                      onChange={(e) => setAddShareRole(e.target.value as 'editor' | 'viewer')}
                      className="text-sm border border-b-border rounded-xl px-2 py-2 bg-b-clay text-b-fg focus:outline-none cursor-pointer flex-shrink-0"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button
                      onClick={() => void addShareMember()}
                      disabled={!addShareIdentifier.trim() || addShareBusy}
                      className="flex-shrink-0 px-4 py-2 rounded-xl bg-b-primary text-white text-sm font-semibold disabled:opacity-40 cursor-pointer border-0 hover:opacity-90 transition-opacity"
                    >
                      Add
                    </button>
                  </div>
                  {addShareError && <p className="text-xs text-red-500">{addShareError}</p>}
                  <p className="text-xs text-b-fg/40 font-sans mt-1">
                    Viewer: read-only · Editor: can rename and delete meetings in this folder
                  </p>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-serif text-xl font-bold text-b-fg mb-6">Folders</h3>

                {/* Folder list */}
                <div className="flex-1 overflow-y-auto flex flex-col gap-2 mb-6 min-h-0">
                  {folders.length === 0 && (
                    <p className="text-sm text-b-fg/40 font-sans text-center py-4">No folders yet — create one below.</p>
                  )}
                  {folders.map((f) => {
                    const count = meetings.filter((m) => m.folder_id === f.id).length
                    const isRenaming = renamingFolderId === f.id
                    const isConfirmingDelete = confirmDeleteFolderId === f.id
                    const isOwned = canManageShares(f, currentUserId ?? '')

                    return (
                      <div key={f.id} className="flex flex-col gap-2 rounded-2xl border border-b-border px-4 py-3">
                        {isRenaming ? (
                          <div className="flex items-center gap-2">
                            <input
                              className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-b-clay border border-b-primary text-b-fg text-sm font-semibold outline-none"
                              value={renameFolderTitle}
                              maxLength={100}
                              autoFocus
                              onChange={(e) => setRenameFolderTitle(e.target.value)}
                              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                                if (e.key === 'Enter') void saveRenameFolder(f.id)
                                if (e.key === 'Escape') { setRenamingFolderId(null); setRenameFolderError(null) }
                              }}
                            />
                            <button
                              disabled={folderBusy === f.id}
                              onClick={() => { void saveRenameFolder(f.id) }}
                              className="px-3 py-1.5 rounded-full bg-b-fg text-white text-xs font-semibold cursor-pointer border-0 hover:opacity-80 flex-shrink-0"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => { setRenamingFolderId(null); setRenameFolderError(null) }}
                              className="px-3 py-1.5 rounded-full border border-b-border text-b-fg/60 text-xs cursor-pointer bg-transparent hover:bg-b-clay flex-shrink-0"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="flex-1 min-w-0 text-sm font-semibold text-b-fg truncate">
                              {f.myRole !== 'owner' ? '👥' : '📁'} {f.name}
                              {f.myRole !== 'owner' && (
                                <span className="ml-1.5 text-xs font-normal text-b-fg/40">
                                  by @{f.ownerUsername} · {f.myRole}
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-b-fg/40 flex-shrink-0">
                              {count} meeting{count !== 1 ? 's' : ''}
                            </span>
                            {isOwned && (
                              <>
                                <button
                                  onClick={() => void openSharePanel(f.id)}
                                  className="px-2.5 py-1 rounded-full border border-b-primary/40 text-b-primary text-xs cursor-pointer bg-transparent hover:bg-b-primary/10 transition-colors flex-shrink-0"
                                >
                                  Share
                                </button>
                                <button
                                  disabled={folderBusy === f.id}
                                  onClick={() => startRenameFolder(f)}
                                  className="px-2.5 py-1 rounded-full border border-b-border text-b-fg/60 text-xs cursor-pointer bg-transparent hover:bg-b-clay hover:text-b-fg transition-colors flex-shrink-0"
                                >
                                  Rename
                                </button>
                                <button
                                  disabled={folderBusy === f.id}
                                  onClick={() => { setConfirmDeleteFolderId(f.id); setRenamingFolderId(null) }}
                                  className="px-2.5 py-1 rounded-full border border-red-100 text-red-400 text-xs cursor-pointer bg-transparent hover:bg-red-50 hover:text-red-600 transition-colors flex-shrink-0"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        )}

                        {renameFolderError && isRenaming && (
                          <p className="text-xs text-red-500">{renameFolderError}</p>
                        )}

                        {/* Inline delete confirmation */}
                        {isConfirmingDelete && (
                          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex flex-col gap-2">
                            <p className="text-xs text-red-700 font-sans leading-relaxed">
                              Delete <strong>&ldquo;{f.name}&rdquo;</strong>?
                              {count > 0
                                ? ` The ${count} meeting${count !== 1 ? 's' : ''} inside will move to Uncategorized — they won't be deleted.`
                                : ' This folder is empty.'}
                            </p>
                            <div className="flex gap-2">
                              <button
                                disabled={folderBusy === f.id}
                                onClick={() => { void deleteFolder(f.id) }}
                                className="px-3 py-1 rounded-full bg-red-600 text-white text-xs font-semibold cursor-pointer border-0 hover:bg-red-700 transition-colors disabled:opacity-60"
                              >
                                Delete folder
                              </button>
                              <button
                                onClick={() => setConfirmDeleteFolderId(null)}
                                className="px-3 py-1 rounded-full border border-red-200 text-red-600 text-xs cursor-pointer bg-transparent hover:bg-red-50 transition-colors"
                              >
                                Keep it
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Create new folder */}
                <div className="border-t border-b-border pt-4">
                  <p className="text-xs font-semibold text-b-fg/60 font-sans uppercase tracking-wide mb-2">New folder</p>
                  <form
                    onSubmit={(e) => { e.preventDefault(); void createFolder() }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="e.g. Sprint Reviews"
                      maxLength={100}
                      disabled={newFolderBusy}
                      className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-b-border bg-b-clay text-sm font-sans text-b-fg focus:outline-none focus:ring-2 focus:ring-b-primary/40 disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={!newFolderName.trim() || newFolderBusy}
                      className="flex-shrink-0 px-4 py-2 rounded-xl bg-b-primary text-white text-sm font-semibold disabled:opacity-40 cursor-pointer border-0 hover:opacity-90 transition-opacity"
                    >
                      Create
                    </button>
                  </form>
                  {newFolderError && <p className="text-xs text-red-500 mt-1.5">{newFolderError}</p>}
                </div>

                {/* Close */}
                <button
                  onClick={() => setManageFoldersOpen(false)}
                  className="mt-4 self-end text-xs text-b-fg/40 font-sans hover:text-b-fg/60 transition-colors cursor-pointer bg-transparent border-0"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
