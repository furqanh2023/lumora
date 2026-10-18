Lumora Account Pill + Dropdown Identity Layout Fix

Changed files only:
- src/Components/Dashboard/DashboardLayout.jsx
- src/Components/Dashboard/DashboardLayout.css

Fixes:
- The top pill displays the signed-in account email on the second line, next to the active/offline status pill.
- OWNER/USER badge sits beside the display name in both the top pill and dropdown.
- Dropdown username is directly below the name; excessive vertical gap removed.
- Dropdown email remains visible as its own line.
- Preserves circular premium avatar ring and compact top pill.
- No chat logic or Firebase rules/configuration changed.

Validation performed: JSX markup replacement checks and ZIP integrity check. Not run in the user's local browser.
