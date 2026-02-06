// 🧩 FIX untuk Baileys v7.x di Docker/Pterodactyl
const { webcrypto: _webcrypto } = require("crypto");
if (!globalThis.crypto) globalThis.crypto = _webcrypto;
if (!globalThis.crypto.subtle) globalThis.crypto.subtle = _webcrypto.subtle;

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const { Boom } = require("@hapi/boom");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const VIDEO_STORAGE_DIR = "/home/container/ttvideo";
if (!fs.existsSync(VIDEO_STORAGE_DIR)) fs.mkdirSync(VIDEO_STORAGE_DIR);

const adminList = [
  "6285141495185@s.whatsapp.net",
  "6285603685874@s.whatsapp.net",
  "6283132007175@s.whatsapp.net"
];

const TIKWM_API_URL = "https://www.tikwm.com/api/";

process.on("uncaughtException", err => console.error("⚠️ Uncaught Exception:", err));
process.on("unhandledRejection", err => console.error("⚠️ Unhandled Rejection:", err));

async function downloadTikTokVideo(url) {
  try {
    const res = await axios.post(TIKWM_API_URL, { url });
    if (res.data?.data?.play) return res.data.data.play;
    throw new Error("Tidak dapat menemukan link download.");
  } catch (error) {
    throw new Error(`Gagal download: ${error.message}`);
  }
}

function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -i "${inputPath}" -vf "scale=720:-2" -r 30 -c:v libx264 -preset veryfast -crf 23 -b:v 1500k -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`;
    exec(cmd, err => (err ? reject(err) : resolve(outputPath)));
  });
}

// =========================
// MAIN BOT FUNCTION
// =========================
async function startBot() {
  try {
    // Hapus auth_info jika ada error sebelumnya
    if (fs.existsSync("./auth_info/error.flag")) {
      console.log("🔄 Reset session karena error sebelumnya...");
      fs.rmSync("./auth_info", { recursive: true, force: true });
    }
    
    const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
    
    // Cek kredensial
    if (!state.creds || !state.creds.noiseKey || !state.creds.signedIdentityKey) {
      console.log("🗑️ Kredensial tidak valid, resetting...");
      fs.rmSync("./auth_info", { recursive: true, force: true });
      fs.mkdirSync("./auth_info", { recursive: true });
      return startBot();
    }

    // Buat logger yang sederhana
    const logger = {
      trace: (msg, data) => console.log(`🔍 TRACE: ${msg}`, data),
      debug: (msg, data) => console.log(`🐛 DEBUG: ${msg}`, data),
      info: (msg, data) => console.log(`ℹ️ INFO: ${msg}`, data),
      warn: (msg, data) => console.warn(`⚠️ WARN: ${msg}`, data),
      error: (msg, data) => console.error(`❌ ERROR: ${msg}`, data),
      fatal: (msg, data) => console.error(`💀 FATAL: ${msg}`, data),
      child: () => logger // Return itself for compatibility
    };

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      // Konfigurasi browser yang lebih umum
      browser: ["Ubuntu", "Chrome", "122.0.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false, // Nonaktifkan sementara
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 15000,
      defaultQueryTimeoutMs: 60000,
      emitOwnEvents: true,
      generateHighQualityLinkPreview: true,
      // Hapus logger atau gunakan yang sederhana
      // logger: logger, // Opsional, bisa dihapus
      retryRequestDelayMs: 2000,
      maxMsgRetryCount: 5,
      fireInitQueries: false, // Nonaktifkan dulu untuk debugging
      appVersion: {
        primary: 2,
        secondary: 3000,
        tertiary: 101
      },
      getMessage: async (key) => {
        return null;
      }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      // Handle QR Code secara manual
      if (qr) {
        console.log("\n" + "=".repeat(50));
        console.log("🔷 SCAN QR CODE INI DENGAN WHATSAPP:");
        console.log("=".repeat(50));
        qrcode.generate(qr, { small: true });
        console.log("\n⏳ QR Code valid selama 30 detik");
        console.log("=".repeat(50) + "\n");
      }
      
      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`❌ Koneksi terputus. Status: ${statusCode || 'Unknown'}`);
        
        if (statusCode === 401 || statusCode === 403 || statusCode === 419) {
          console.log("🔄 Session expired. Menghapus auth_info...");
          // Tandai error untuk reset di next start
          fs.writeFileSync("./auth_info/error.flag", "1");
          fs.rmSync("./auth_info", { recursive: true, force: true });
          console.log("✅ Auth info dihapus. Restarting...");
        }
        
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log(`⏳ Reconnecting in 3s...`);
          setTimeout(() => {
            try { startBot(); } catch(e) { console.error("Restart error:", e); }
          }, 3000);
        }
      } else if (connection === "open") {
        console.log("\n" + "=".repeat(50));
        console.log("✅ BOT BERHASIL TERHUBUNG!");
        console.log(`📱 User: ${sock.user?.name || 'Unknown'}`);
        console.log(`🔢 Number: ${sock.user?.id || 'Unknown'}`);
        console.log("=".repeat(50) + "\n");
        // Hapus flag error jika ada
        if (fs.existsSync("./auth_info/error.flag")) {
          fs.unlinkSync("./auth_info/error.flag");
        }
      } else if (connection === "connecting") {
        console.log("🔄 Connecting to WhatsApp servers...");
      }
    });

    // ===================== PESAN EVENT =====================
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      try {
        if (type !== "notify") return;
        
        const msg = messages[0];
        if (!msg?.message || msg.key.remoteJid === "status@broadcast" || msg.key.fromMe) return;

        let chatId = msg.key.remoteJid;
        const sender = msg.key.participant || chatId;

        // Handle @lid suffix
        if (chatId.endsWith("@lid") && sender) {
          const realNumber = sender.replace(/[^0-9]/g, "");
          if (realNumber) chatId = `${realNumber}@s.whatsapp.net`;
        }

        // Extract message text
        const body = 
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          "";

        if (!body.trim()) return;

        console.log(`📩 Pesan dari ${chatId}: ${body.substring(0, 50)}...`);

        // Helper untuk kirim pesan
        const sendMsg = async (content, retryCount = 0) => {
          try {
            await sock.sendMessage(chatId, content);
            return true;
          } catch (err) {
            console.error(`❌ Gagal kirim (attempt ${retryCount + 1}):`, err.message);
            if (retryCount < 2) {
              await new Promise(r => setTimeout(r, 2000 * (retryCount + 1)));
              return sendMsg(content, retryCount + 1);
            }
            return false;
          }
        };

        // ========== /help ==========
        if (body === "/help" || body === "!help" || body === ".help") {
          await sendMsg({
            text: `*🤖 Bot Whatsapp By Curzy*\n
*📜 PERINTAH:*
1. /help - Menu bantuan
2. /tt <link> - Download TikTok video

*💡 CONTOH:*
/tt https://vt.tiktok.com/abc123

*👑 OWNER:* Tokisaki Curzy
*📆* ${new Date().toLocaleDateString('id-ID')}`
          });
          return;
        }



        // ========== /tt ==========
        if (body.startsWith("/tt ") || body.startsWith("!tt ") || body.startsWith(".tt ")) {
          const args = body.split(" ");
          if (args.length < 2) {
            await sendMsg({ text: "❌ *Format salah!*\nGunakan: /tt <link_tiktok>\nContoh: /tt https://vm.tiktok.com/xxxx" });
            return;
          }
          
          const link = args[1];
          if (!link.includes("tiktok.com") && !link.includes("douyin.com")) {
            await sendMsg({ text: "❌ *Link tidak valid!*\nPastikan link dari TikTok." });
            return;
          }
          
          await sendMsg({ text: "⏳ *Mengunduh video TikTok...*\nMohon tunggu beberapa detik." });
          
          try {
            const videoUrl = await downloadTikTokVideo(link);
            const fileName = `tiktok_${Date.now()}.mp4`;
            const filePath = path.join(VIDEO_STORAGE_DIR, fileName);
            
            console.log(`📥 Downloading from: ${videoUrl}`);
            
            const response = await axios({
              method: 'GET',
              url: videoUrl,
              responseType: 'stream',
              timeout: 30000
            });
            
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);
            
            await new Promise((resolve, reject) => {
              writer.on('finish', resolve);
              writer.on('error', reject);
            });
            
            // Kirim video
            await sendMsg({
              video: { url: filePath },
              gifPlayback: false
            });
            
            console.log(`✅ Video sent: ${fileName}`);
            
            // Cleanup setelah 1 menit
            setTimeout(() => {
              try {
                if (fs.existsSync(filePath)) {
                  fs.unlinkSync(filePath);
                  console.log(`🗑️ Cleaned up: ${fileName}`);
                }
              } catch (e) {}
            }, 60000);
            
          } catch (error) {
            console.error("TikTok download error:", error);
            await sendMsg({ 
              text: `❌ *Gagal mengunduh video!*\nError: ${error.message}\nPastikan link valid dan coba lagi.` 
            });
          }
          return;
        }
        
        // Auto response untuk pesan lain
        if (body.startsWith("/")) {
          await sendMsg({
            text: `❓ *Perintah tidak dikenali!*\nKetik /help untuk melihat menu perintah.`
          });
        }
        
      } catch (error) {
        console.error("Error processing message:", error);
      }
    });

    // Handle errors
    sock.ev.on("connection.update", (update) => {
      if (update.error) {
        console.error("❌ Connection error:", update.error);
      }
    });

  } catch (error) {
    console.error("🔥 Critical error in startBot:", error);
    console.log("🔄 Restarting in 5 seconds...");
    setTimeout(() => {
      try { startBot(); } catch(e) { console.error("Failed to restart:", e); }
    }, 5000);
  }
}



// Handle exit
process.on("SIGINT", () => {
  console.log("\n👋 Bot dihentikan oleh user (Ctrl+C)");
  process.exit(0);
});

process.on("exit", (code) => {
  console.log(`📴 Bot berhenti dengan kode: ${code}`);
});

// Start bot dengan try-catch
try {
  console.log("🚀 Starting WhatsApp Bot...");
  startBot();
} catch (error) {
  console.error("💥 Failed to start bot:", error);
  process.exit(1);
}
