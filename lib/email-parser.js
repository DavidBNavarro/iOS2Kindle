function parseSendGridWebhook(payload) {
  const from = payload.from || "";
  const to = payload.to || "";
  const subject = payload.subject || "";
  const html = payload.html || "";
  const text = payload.text || "";

  const forwardingAddress = to.trim();

  const senderMatch = from.match(/^"?([^"<]*)"?\s*(?:<([^>]+)>)?$/);
  let senderName = "";
  let senderEmail = from;
  if (senderMatch) {
    senderName = (senderMatch[1] || "").trim();
    if (senderMatch[2]) {
      senderEmail = senderMatch[2].trim();
    }
  }

  let body = html || text;
  let bodyType = html ? "html" : "text";

  return {
    from,
    to,
    forwardingAddress,
    subject,
    senderName,
    senderEmail,
    html,
    text,
    body,
    bodyType
  };
}

module.exports = { parseSendGridWebhook };
