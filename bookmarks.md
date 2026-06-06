## Sharing Custom Levels via URL

You can share a custom level by hosting its JSON file publicly and
encoding the URL into the game URL:

|`
  https://aol.cognotik.com/?level=<URL-encoded-https-URL>
|`

### Example

If you host `mylevel.json` at `https://localhost:8080/levels/invaders.json`,
the shareable URL becomes:

|`
  https://aol.cognotik.com/?level=https%3A%2F%2Flocalhost%3A8080%2Flevels%2Finvaders.json
|`
Or if hosting on `localhost:8080`
|`
  http://localhost:8080/?level=http%3A%2F%2Flocalhost%3A8080%2Flevels%2Finvaders.json
|`

### Quick Workflow

1. Open the **Level Designer** (button on main menu).
2. Design your level and click **Export JSON** to copy the JSON.
3. Host that JSON publicly (GitHub Gist raw URL, your own server, etc.).
4. Click **🔗 Copy Share URL** and paste the public URL.
5. The game generates a shareable URL — share it!

### Security

- Only `https://` URLs are accepted (no `http://` or `file://`).
- Levels are validated against the schema before loading.
- Maximum JSON size is 5 MB.
- The hosted server must serve appropriate CORS headers so the browser
  can fetch the JSON from the game's origin.

### Errors

If the URL fails to load (bad URL, CORS issue, invalid JSON), a red
banner appears at the top of the page with the error message. Click
the banner to dismiss, or it will auto-dismiss after 10 seconds.
