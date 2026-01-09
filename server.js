const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const cors = require('cors');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

let sock = null;
let qrCodeData = null;
let isConnected = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = await QRCode.toDataURL(qr);
            io.emit('qr', qrCodeData);
        }

        if (connection === 'close') {
            isConnected = false;
            io.emit('disconnected');
            // Tenta reconectar se não for um logout intencional
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            isConnected = true;
            qrCodeData = null;
            io.emit('connected');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        io.emit('message', {
            from: msg.key.remoteJid,
            text: msg.message.conversation || msg.message.extendedTextMessage?.text,
            fromMe: msg.key.fromMe,
            timestamp: msg.messageTimestamp
        });
    });
}

app.get('/qr', (req, res) => {
    res.json({ qr: qrCodeData, connected: isConnected });
});

app.post('/send', async (req, res) => {
    const { number, message } = req.body;

    if (!sock || !isConnected) {
        return res.status(500).json({ error: "WhatsApp não está conectado" });
    }

    try {
        // CORREÇÃO: Removidas as barras invertidas extras
        await sock.sendMessage(`${number}@s.whatsapp.net`, { text: message });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    // CORREÇÃO: Removidas as barras invertidas extras
    console.log(`Server running on port ${PORT}`);
    connectToWhatsApp();
});