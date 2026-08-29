import { sendPanelMessage } from './panelMessaging.js';

export async function sendMessage(req, res) {
  return sendPanelMessage(req, res);
}

export default { sendMessage };
