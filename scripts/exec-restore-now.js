const token = process.env.WHATSAPP_TOKEN;
const wabaId = '1363917525928617';
if (!token) {
  console.error('Missing WHATSAPP_TOKEN in environment. Aborting.');
  process.exit(2);
}

(async () => {
  try {
    const url = 'https://graph.facebook.com/v20.0/' + wabaId + '/subscribed_apps';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { }
    console.log('HTTP_STATUS:', res.status);
    console.log('RESPONSE_BODY:', text);
    console.log('PARSED_JSON:', json);
  } catch (err) {
    console.error('ERROR:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();