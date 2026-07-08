// Pure helpers for chat scope derivation — no I/O, fully testable.
// Three scopes: meeting (one meeting), folder (set of meetings), global (all).

/**
 * Derive the meetingIds filter array to pass to retrieveContext().
 *
 * - Single meeting:  meetingId set → [meetingId]
 * - Folder scope:    folderMeetingIds set (possibly empty) → folderMeetingIds
 * - Global scope:    both null → null (no filter; RLS enforces access)
 */
export function deriveMeetingIds(
  meetingId: string | null,
  folderMeetingIds: string[] | null,
): string[] | null {
  if (meetingId) return [meetingId]
  if (folderMeetingIds !== null) return folderMeetingIds
  return null
}

/**
 * Validate that at most one scope anchor is set.
 * Returns an error message string, or null if valid.
 */
export function validateChatScope(
  meetingId: string | null,
  folderId: string | null,
): string | null {
  if (meetingId && folderId) {
    return 'Provide meetingId or folderId, not both.'
  }
  return null
}
