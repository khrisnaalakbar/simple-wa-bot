import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion, makeCacheableSignalKeyStore, downloadContentFromMessage } from 'baileys'
import fs from 'fs'
import pino from 'pino'
import chalk from 'chalk'
import readline from 'readline'
import os from 'os'
import { exec } from 'child_process'
import { fileTypeFromBuffer } from 'file-type'
import ffmpeg from 'fluent-ffmpeg'
import webpmux from 'node-webpmux'
import path from 'path'
import { performance } from 'perf_hooks'
import { sizeFormatter } from 'human-readable'
import osu from 'node-os-utils'
import axios from 'axios'

const ownerNumber = ['6285751561624'] 
const botName = 'simple-md'
let isPublic = true
const usePairingCode = true 

const formatSize = sizeFormatter({
    std: 'JEDEC',
    decimalPlaces: 2,
    keepTrailingZeroes: false,
    render: (literal, symbol) => `${literal} ${symbol}B`,
})

const question = (text) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    return new Promise((resolve) => {
        rl.question(text, (answer) => {
            resolve(answer)
            rl.close()
        })
    })
}

async function imageToWebp(media) {
    const tmpFileOut = path.join(os.tmpdir(), `${Math.random().toString(36)}`)
    const tmpFileIn = path.join(os.tmpdir(), `${Math.random().toString(36)}`)
    fs.writeFileSync(tmpFileIn, media)
    await new Promise((resolve, reject) => {
        ffmpeg(tmpFileIn)
            .on("error", reject)
            .on("end", () => resolve(true))
            .addOutputOptions([
                "-vcodec", "libwebp",
                "-vf", "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:-1:-1:color=white@0.0, split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse"
            ])
            .toFormat("webp")
            .save(tmpFileOut)
    })
    const buff = fs.readFileSync(tmpFileOut)
    fs.unlinkSync(tmpFileOut)
    fs.unlinkSync(tmpFileIn)
    return buff
}

async function videoToWebp(media) {
    const tmpFileOut = path.join(os.tmpdir(), `${Math.random().toString(36)}`)
    const tmpFileIn = path.join(os.tmpdir(), `${Math.random().toString(36)}`)
    fs.writeFileSync(tmpFileIn, media)
    await new Promise((resolve, reject) => {
        ffmpeg(tmpFileIn)
            .on("error", reject)
            .on("end", () => resolve(true))
            .addOutputOptions([
                "-vcodec", "libwebp",
                "-vf", "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:-1:-1:color=white@0.0, split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse",
                "-loop", "0",
                "-ss", "00:00:00",
                "-t", "00:00:05",
                "-preset", "default",
                "-an",
                "-vsync", "0"
            ])
            .toFormat("webp")
            .save(tmpFileOut)
    })
    const buff = fs.readFileSync(tmpFileOut)
    fs.unlinkSync(tmpFileOut)
    fs.unlinkSync(tmpFileIn)
    return buff
}

async function writeExif(media, metadata) {
    let wMedia = await imageToWebp(media)
    const tmpFileIn = path.join(os.tmpdir(), `${Math.random().toString(36)}.webp`)
    const tmpFileOut = path.join(os.tmpdir(), `${Math.random().toString(36)}.webp`)
    fs.writeFileSync(tmpFileIn, wMedia)
    if (metadata.packname || metadata.author) {
        const img = new webpmux.Image()
        const json = { 
            "sticker-pack-id": `https://github.com/khrisna-al-akbar`, 
            "sticker-pack-name": metadata.packname, 
            "sticker-pack-publisher": metadata.author, 
            "emojis": metadata.categories ? metadata.categories : [""] 
        }
        const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00])
        const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8")
        const exif = Buffer.concat([exifAttr, jsonBuff])
        exif.writeUIntLE(jsonBuff.length, 14, 4)
        await img.load(tmpFileIn)
        fs.unlinkSync(tmpFileIn)
        img.exif = exif
        await img.save(tmpFileOut)
        return fs.readFileSync(tmpFileOut)
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    const { version } = await fetchLatestWaWebVersion()
    
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !usePairingCode,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }).child({ level: "store" })),
        },
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        generateHighQualityLinkPreview: true,
    })

    if (usePairingCode && !sock.authState.creds.registered) {
        console.log(chalk.yellow('Silakan masukkan nomor WhatsApp Anda (contoh: 628xxx):'))
        const phoneNumber = await question(chalk.green('Nomor: '))
        const code = await sock.requestPairingCode(phoneNumber.trim())
        console.log(chalk.green(`Kode Pairing Anda: ${code}`))
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('Koneksi terputus, mencoba menghubungkan ulang...', shouldReconnect)
            if (shouldReconnect) {
                startBot()
            }
        } else if (connection === 'open') {
            console.log(chalk.green('Bot Terhubung!'))
        }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async chatUpdate => {
        try {
            let m = chatUpdate.messages[0]
            if (!m.message) return
            m.message = (Object.keys(m.message)[0] === 'ephemeralMessage') ? m.message.ephemeralMessage.message : m.message
            if (m.key && m.key.remoteJid === 'status@broadcast') return
            if (!sock.public && !m.key.fromMe && chatUpdate.type === 'notify') return
            
            const content = JSON.stringify(m.message)
            const from = m.key.remoteJid
            const type = Object.keys(m.message)[0]
            const body = (type === 'conversation') ? m.message.conversation : (type == 'imageMessage') ? m.message.imageMessage.caption : (type == 'videoMessage') ? m.message.videoMessage.caption : (type == 'extendedTextMessage') ? m.message.extendedTextMessage.text : ''
            const isGroup = from.endsWith('@g.us')
            const sender = isGroup ? (m.key.participant ? m.key.participant : m.participant) : m.key.remoteJid
            const senderNumber = sender.split('@')[0]
            const isOwner = ownerNumber.includes(senderNumber)
            
            if (!isPublic) {
                if (!isOwner && !m.key.fromMe) return
            }

            if (body.startsWith('.')) {
                const command = body.slice(1).trim().split(/ +/).shift().toLowerCase()
                const args = body.trim().split(/ +/).slice(1)
                const text = args.join(' ')

                switch (command) {
                    case 'menu': {
                        const uptime = process.uptime()
                        const uptimeString = new Date(uptime * 1000).toISOString().substr(11, 8)
                        const ramUsage = await osu.mem.info()
                        const cpuUsage = await osu.cpu.usage()
                        const osPlatform = os.platform()

                        const menuText = ` *hello world,*
*My name is Simple md.*

*〕Server:*
> *→ Runtime: ${uptimeString}*
> *→ Ram: ${ramUsage.usedMemPercentage}%*
> *→ CPU: ${cpuUsage}%*
> *→ OS:  ${osPlatform}*

*〕Menu:*
  *◦ Basic*
> *→ Menu*
> *→ Ping*

  *◦ Stiker*
> *→ .sticker*
> *→ .brat*
> *→ .bratvid*

  *◦ AI*
> *→ .ai*
> *→ .worm*
> *→ .img*

  *◦ Tools*
> *→ .ssweb*
> *→ .animfind*

  *◦ Downloads*
> *→ .tt*
> *→ .ig*
> *→ .ytb*

  *◦ Stalker*
> *→ .igstalk*
> *→ .ttstalk*
> *→ .rbxstalk*`

                        await sock.sendMessage(from, { text: menuText }, { quoted: m })
                        break
                    }

                    case 'ping': {
                        const oldTs = performance.now()
                        const newTs = performance.now()
                        const ping = newTs - oldTs
                        await sock.sendMessage(from, { text: `Pong! ${ping.toFixed(3)} ms.` }, { quoted: m })
                        break
                    }

                    case 'sticker':
                    case 's': {
                        await sock.sendMessage(from, { text: '> *〕Sedang membuat...*' }, { quoted: m })
                        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage || m.message
                        const mime = Object.keys(quoted)[0]
                        if (mime === 'imageMessage' || mime === 'videoMessage') {
                            try {
                                const stream = await downloadContentFromMessage(quoted[mime], mime.replace('Message', ''))
                                let buffer = Buffer.from([])
                                for await (const chunk of stream) {
                                    buffer = Buffer.concat([buffer, chunk])
                                }
                                let stickerBuff
                                if (mime === 'imageMessage') {
                                    stickerBuff = await writeExif(buffer, { packname: botName, author: 'Simple MD' })
                                } else {
                                    stickerBuff = await videoToWebp(buffer) 
                                }
                                if (stickerBuff) await sock.sendMessage(from, { sticker: stickerBuff }, { quoted: m })
                            } catch (e) {
                                await sock.sendMessage(from, { text: '> *〕Gagal membuat stiker.*' }, { quoted: m })
                            }
                        } else {
                            sock.sendMessage(from, { text: '> *〕Kirim atau replay gambar.*' }, { quoted: m })
                        }
                        break
                    }

                    case 'brat': {
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan teks, contoh: .brat hello world*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang membuat...*' }, { quoted: m })
                        try {
                            const url = `https://zelapioffciall.koyeb.app/imagecreator/bratv2?text=${encodeURIComponent(text)}`
                            const res = await axios.get(url, { responseType: 'arraybuffer' })
                            const stickerBuff = await writeExif(res.data, { packname: botName, author: 'Simple MD' })
                            await sock.sendMessage(from, { sticker: stickerBuff }, { quoted: m })
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi kesalahan saat membuat brat.*' }, { quoted: m })
                        }
                        break
                    }

                    case 'bratvid': {
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan teks, contoh: .brat hello world*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang membuat...*' }, { quoted: m })
                        try {
                            const url = `https://zelapioffciall.koyeb.app/imagecreator/bratvid?text=${encodeURIComponent(text)}`
                            const res = await axios.get(url, { responseType: 'arraybuffer' })
                            const stickerBuff = await videoToWebp(res.data)
                            await sock.sendMessage(from, { sticker: stickerBuff }, { quoted: m })
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi kesalahan saat membuat bratvid.*' }, { quoted: m })
                        }
                        break
                    }

                    case 'ai': {
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan pertanyaan atau perintah, contoh: .ai apa itu NodeJS*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang berfikir...*' }, { quoted: m })
                        try {
                            const res = await axios.get(`https://zelapioffciall.koyeb.app/ai/chatbot?text=${encodeURIComponent(text)}`)
                            if (res.data.status && res.data.answer) {
                                await sock.sendMessage(from, { text: res.data.answer }, { quoted: m })
                            } else {
                                await sock.sendMessage(from, { text: '> *〕Gagal mendapatkan jawaban.*' }, { quoted: m })
                            }
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi kesalahan API.*' }, { quoted: m })
                        }
                        break
                    }

                    case 'worm': {
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan pertanyaan atau perintah, contoh: .worm apa itu NodeJS*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang berfikir...*' }, { quoted: m })
                        try {
                            const res = await axios.get(`https://zelapioffciall.koyeb.app/ai/hackai?text=${encodeURIComponent(text)}`)
                            if (res.data.status && res.data.result && res.data.result.message) {
                                await sock.sendMessage(from, { text: res.data.result.message }, { quoted: m })
                            } else {
                                await sock.sendMessage(from, { text: '> *〕Gagal mendapatkan jawaban.*' }, { quoted: m })
                            }
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi kesalahan API.*' }, { quoted: m })
                        }
                        break
                    }

                    case 'img': {
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan perintah, contoh: .img buatkan saya gambar kucing.*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang membuat gambar...*' }, { quoted: m })
                        try {
                            const res = await axios.get(`https://zelapioffciall.koyeb.app/imagecreator/aifreebox?prompt=${encodeURIComponent(text)}&ratio=1%3A1`)
                            if (res.data.status && res.data.imageUrl) {
                                await sock.sendMessage(from, { image: { url: res.data.imageUrl }, caption: res.data.prompt }, { quoted: m })
                            } else {
                                await sock.sendMessage(from, { text: '> *〕Gagal membuat gambar.*' }, { quoted: m })
                            }
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi kesalahan API.*' }, { quoted: m })
                        }
                        break
                    }

                    case 'ssweb': {
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan link dengan awalan http:// atau https://, contoh: .ssweb https://khrisnaalakbar.site/*' }, { quoted: m })
                        if (!text.startsWith('http')) return sock.sendMessage(from, { text: '> *〕Link tidak valid.*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang mengambil gambar...*' }, { quoted: m })
                        try {
                            const url = `https://api.zenzxz.my.id/api/tools/ssweb?url=${encodeURIComponent(text)}`
                            await sock.sendMessage(from, { image: { url: url }, caption: 'Done' }, { quoted: m })
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Gagal mengambil screenshot.*' }, { quoted: m })
                        }
                        break
                    }

                    case 'animfind':
                    case 'tt':
                    case 'ig':
                    case 'ytb':
                    case 'igstalk':
                    case 'ttstalk':
                    case 'rbxstalk': {
                        await sock.sendMessage(from, { text: '> *〕Fitur dalam perbaikan.*' }, { quoted: m })
                        break
                    }

                    case 'self': {
                        if (!isOwner) return 
                        isPublic = false
                        await sock.sendMessage(from, { text: 'Mode berhasil diubah ke Self' }, { quoted: m })
                        break
                    }

                    case 'public': {
                        if (!isOwner) return
                        isPublic = true
                        await sock.sendMessage(from, { text: 'Mode berhasil diubah ke Public' }, { quoted: m })
                        break
                    }
                }
            }
        } catch (e) {
            console.log(e)
        }
    })
}

startBot()

