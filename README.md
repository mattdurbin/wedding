# Wedding site with public redaction

What changed:
- Public messages page no longer shows the contact field
- Public message text is automatically redacted for:
  - email addresses
  - phone numbers
  - the exact submitted contact value if repeated in the message
- Private CSV export still includes the original contact field and original message text

Files:
- index.html
- gallery.html
- messages.html
- worker.js
- README.md

To update:
1. Replace your Worker with worker.js
2. Deploy the Worker
3. Upload index.html, gallery.html, and messages.html to Pages
4. Deploy Pages
