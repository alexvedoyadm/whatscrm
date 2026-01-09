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
    // Certifique-se de que a pasta 'auth_info' existe e tem permissão de escrita
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Mantém no terminal para backup
        browser: ['WhatsApp Web Clone', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = await QRCode.toDataURL(qr);
            io.emit('qr', qrCodeData); // Envia o QR para quem já está conectado
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            isConnected = false;
            qrCodeData = null;
            io.emit('disconnected');
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            isConnected = true;
            qrCodeData = null;
            console.log('✅ WhatsApp Conectado!');
            io.emit('connected');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        io.emit('message', {
            from: msg.key.remoteJid,
            text: msg.message.conversation || msg.message.extendedTextMessage?.text || "Mensagem de mídia",
            fromMe: false,
            timestamp: msg.messageTimestamp
        });
    });
}

// Rota para entregar o QR atual para novos acessos
app.get('/qr', (req, res) => {
    res.json({ qr: qrCodeData, connected: isConnected });
});

app.post('/send', async (req, res) => {
    const { number, message } = req.body;
    if (!isConnected) return res.status(500).json({ error: "WhatsApp não conectado" });
    
    try {
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em: http://localhost:${PORT}`);
    connectToWhatsApp();
});

// Evento quando o usuário abre o site
io.on('connection', (socket) => {
    if (qrCodeData) socket.emit('qr', qrCodeData);
    if (isConnected) socket.emit('connected');
});