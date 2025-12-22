# Monday Board Schema (Text-only safe UI)

## Board: MicroFactory Queue
Columns (suggested):
- Site Slug (text) [unique key]
- Niche (text)
- Title (text)
- Description (long text)
- Source Links (long text) (one URL per line)
- Status (status): Draft | Queued | Generated | Deployed | Failed
- Approve (status): Pending | Approved | Rejected
- Live URL (text)
- Last Error (long text)
- Created At (date)
- Updated At (date)

Automation:
- When Approve changes to Approved -> send webhook to Supabase intake endpoint with fields above.
