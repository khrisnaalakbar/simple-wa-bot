import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion, makeCacheableSignalKeyStore, downloadContentFromMessage, jidDecode } from 'baileys'
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
import moment from 'moment-timezone'
import FormData from 'form-data'

const ownerNumber = ['6283896149378']
const botName = 'simple-md'
let isPublic = true
const usePairingCode = true

const getBuffer = async (url, options) => {
    try {
        options ? options : {}
        const res = await axios({
            method: "get",
            url,
            headers: {
                'DNT': 1,
                'Upgrade-Insecure-Requests': 1
            },
            ...options,
            responseType: 'arraybuffer'
        })
        return res.data
    } catch (err) {
        return err
    }
}

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

const getRuntime = (seconds) => {
    seconds = Number(seconds)
    var d = Math.floor(seconds / (3600 * 24))
    var h = Math.floor(seconds % (3600 * 24) / 3600)
    var m = Math.floor(seconds % 3600 / 60)
    var s = Math.floor(seconds % 60)
    var dDisplay = d > 0 ? d + (d == 1 ? " day, " : " days, ") : ""
    var hDisplay = h > 0 ? h + (h == 1 ? " hour, " : " hours, ") : ""
    var mDisplay = m > 0 ? m + (m == 1 ? " minute, " : " minutes, ") : ""
    var sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : ""
    return dDisplay + hDisplay + mDisplay + sDisplay
}

async function uploadToCDN(filePath) {
    try {
        const formData = new FormData()
        formData.append('file', fs.createReadStream(filePath))
        const response = await axios.post('https://cdn.nekohime.site/upload', formData, {
            headers: {
                ...formData.getHeaders(),
            },
        })
        return response.data.files
    } catch (error) {
        throw error
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
        console.log(chalk.yellow('Masukkan nomor bot:'))
        const phoneNumber = await question(chalk.yellow('Nomor: '))
        const code = await sock.requestPairingCode(phoneNumber.trim())
        console.log(chalk.green(`Kode Pairing Anda: ${code}`))
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log(chalk.red('Koneksi terputus'), shouldReconnect)
            if (shouldReconnect) {
                startBot()
            }
        } else if (connection === 'open') {
            console.log(chalk.green('Terhubung'))
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

            const from = m.key.remoteJid
            const type = Object.keys(m.message)[0]
            const body = (type === 'conversation') ? m.message.conversation : (type == 'imageMessage') ? m.message.imageMessage.caption : (type == 'videoMessage') ? m.message.videoMessage.caption : (type == 'extendedTextMessage') ? m.message.extendedTextMessage.text : ''
            const isGroup = from.endsWith('@g.us')
            const sender = isGroup ? (m.key.participant ? m.key.participant : m.participant) : m.key.remoteJid
            const senderNumber = sender.split('@')[0]
            const pushname = m.pushName || "No Name"
            const isOwner = ownerNumber.includes(senderNumber)
            const isCmd = body.startsWith('.')
            const command = isCmd ? body.slice(1).trim().split(/ +/).shift().toLowerCase() : ""
            const args = body.trim().split(/ +/).slice(1)
            const text = args.join(' ')
            const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage || m.message

            console.log(chalk.green('Pesan diterima,'))
            console.log(chalk.cyan(`Dari: ${pushname}`), chalk.yellow(`(${senderNumber})`))
            console.log(chalk.blue(`Waktu: ${moment().tz('Asia/Jakarta').format('HH:mm:ss')}`))
            console.log(chalk.white(`Isi: ${body.length > 50 ? body.substring(0, 50) + '...' : body}`))
            console.log(chalk.magenta(`Tipe: ${type}`))
            console.log(chalk.gray(`Perintah: ${isCmd}`))
            console.log(chalk.gray('--------------------------------------------------'))

            if (!isPublic) {
                if (!isOwner && !m.key.fromMe) return
            }

            if (isCmd) {
                switch (command) {
                    case 'menu':
                        const uptime = process.uptime()
                        const ramTotal = os.totalmem()
                        const ramFree = os.freemem()
                        const usedRam = ramTotal - ramFree
                        const percentRam = (usedRam / ramTotal) * 100
                        const cpu = osu.cpu
                        const cpuUsage = await cpu.usage()
                        
                        const menuText = 
` *hello world,*
*My name is Simple md.*

*〕Server:*
> *→ Runtime: ${getRuntime(uptime)}*
> *→ Ram: ${percentRam.toFixed(2)}%*
> *→ CPU: ${cpuUsage.toFixed(2)}%*
> *→ OS:  ${os.platform()}*

*〕Menu:*
  *◦ Basic*
> *→ .menu*
> *→ .ping*

  *◦ Stiker*
> *→ .sticker*
> *→ .brat*
> *→ .bratvid*

  *◦ AI*
> *→ .ai*
> *→ .worm*
> *→ .img*

  *◦ Tools*
> *→ .tourl*
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

                    case 'ping':
                        const oldTs = performance.now()
                        const newTs = performance.now()
                        const lat = newTs - oldTs
                        await sock.sendMessage(from, { text: `Pong! ${lat.toFixed(3)} ms.` }, { quoted: m })
                        break

                    case 'stiker':
                    case 's':
                    case 'sticker':
                        await sock.sendMessage(from, { text: '> *〕Sedang membuat...*' }, { quoted: m })
                        try {
                            const mime = Object.keys(quoted)[0]
                            if (mime === 'imageMessage' || mime === 'videoMessage' || mime === 'stickerMessage') {
                                const stream = await downloadContentFromMessage(quoted[mime], mime.replace('Message', ''))
                                let buffer = Buffer.from([])
                                for await (const chunk of stream) {
                                    buffer = Buffer.concat([buffer, chunk])
                                }
                                
                                let stickerBuff
                                if (mime === 'imageMessage' || (mime === 'stickerMessage')) {
                                    stickerBuff = await writeExif(buffer, { packname: botName, author: 'Simple MD' })
                                } else if (mime === 'videoMessage') {
                                    stickerBuff = await videoToWebp(buffer)
                                    stickerBuff = await writeExif(stickerBuff, { packname: botName, author: 'Simple MD' })
                                }
                                
                                if (stickerBuff) {
                                    await sock.sendMessage(from, { sticker: stickerBuff }, { quoted: m })
                                }
                            } else {
                                await sock.sendMessage(from, { text: '> *〕Kirim atau replay gambar.*' }, { quoted: m })
                            }
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi masalah pada server.*' }, { quoted: m })
                        }
                        break
                    
                    case 'brat':
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan teks, contoh: .brat hello world*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang membuat...*' }, { quoted: m })
                        try {
                            const url = `https://zelapioffciall.koyeb.app/imagecreator/bratv2?text=${encodeURIComponent(text)}`
                            const resBuffer = await getBuffer(url)
                            const stik = await writeExif(resBuffer, { packname: botName, author: 'Simple MD' })
                            await sock.sendMessage(from, { sticker: stik }, { quoted: m })
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi masalah pada server.*' }, { quoted: m })
                        }
                        break

                    case 'bratvid':
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan teks, contoh: .brat hello world*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang membuat...*' }, { quoted: m })
                        try {
                            const url = `https://zelapioffciall.koyeb.app/imagecreator/bratvid?text=${encodeURIComponent(text)}`
                            const resBuffer = await getBuffer(url)
                            const stik = await videoToWebp(resBuffer)
                            const stikExif = await writeExif(stik, { packname: botName, author: 'Simple MD' })
                            await sock.sendMessage(from, { sticker: stikExif }, { quoted: m })
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi masalah pada server.*' }, { quoted: m })
                        }
                        break

                    case 'ai':
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan pertanyaan atau perintah, contoh: .ai apa itu NodeJS*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang berfikir...*' }, { quoted: m })
                        try {
                            const { data } = await axios.get(`https://zelapioffciall.koyeb.app/ai/chatbot?text=${encodeURIComponent(text)}`)
                            if (data.status && data.answer) {
                                await sock.sendMessage(from, { text: data.answer }, { quoted: m })
                            } else {
                                throw new Error('API Fail')
                            }
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi masalah pada server.*' }, { quoted: m })
                        }
                        break

                    case 'worm':
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan pertanyaan atau perintah, contoh: .worm apa itu NodeJS*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang berfikir...*' }, { quoted: m })
                        try {
                            const { data } = await axios.get(`https://zelapioffciall.koyeb.app/ai/hackai?text=${encodeURIComponent(text)}`)
                            if (data.status && data.result && data.result.message) {
                                await sock.sendMessage(from, { text: data.result.message }, { quoted: m })
                            } else {
                                throw new Error('API Fail')
                            }
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi masalah pada server.*' }, { quoted: m })
                        }
                        break
                    
                    case 'img':
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan perintah, contoh: .img buatkan saya gambar kucing.*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang membuat gambar...*' }, { quoted: m })
                        try {
                            const { data } = await axios.get(`https://zelapioffciall.koyeb.app/imagecreator/aifreebox?prompt=${encodeURIComponent(text)}&ratio=1%3A1`)
                            if (data.status && data.imageUrl) {
                                await sock.sendMessage(from, { image: { url: data.imageUrl }, caption: data.prompt }, { quoted: m })
                            } else {
                                throw new Error('API Fail')
                            }
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi masalah pada server.*' }, { quoted: m })
                        }
                        break
                    
                    case 'tourl':
                        try {
                            const mime = Object.keys(quoted)[0]
                            if (/imageMessage|videoMessage|documentMessage/.test(mime)) {
                                await sock.sendMessage(from, { text: '> *〕Sedang mengupload...*' }, { quoted: m })
                                const type = mime.replace('Message', '')
                                const stream = await downloadContentFromMessage(quoted[mime], type)
                                let buffer = Buffer.from([])
                                for await (const chunk of stream) {
                                    buffer = Buffer.concat([buffer, chunk])
                                }
                                const tmpFile = path.join(os.tmpdir(), `${Math.random().toString(36)}.${type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : 'bin'}`)
                                fs.writeFileSync(tmpFile, buffer)
                                const result = await uploadToCDN(tmpFile)
                                fs.unlinkSync(tmpFile)
                                if (result && result.length > 0) {
                                    await sock.sendMessage(from, { text: `> *〕Upload berhasil, link anda: ${result[0].url}*` }, { quoted: m })
                                } else {
                                    throw new Error('No url')
                                }
                            } else {
                                await sock.sendMessage(from, { text: '> *〕Sertakan gambar, video, atau dokumen.*' }, { quoted: m })
                            }
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi masalah pada server.*' }, { quoted: m })
                        }
                        break

                    case 'ssweb':
                        if (!text) return sock.sendMessage(from, { text: '> *〕Sertakan link dengan awalan http:// atau https://, contoh: .ssweb https://google.com*' }, { quoted: m })
                        await sock.sendMessage(from, { text: '> *〕Sedang mengambil gambar...*' }, { quoted: m })
                        try {
                            const url = `https://api.zenzxz.my.id/api/tools/ssweb?url=${encodeURIComponent(text)}`
                            await sock.sendMessage(from, { image: { url: url }, caption: 'Done' }, { quoted: m })
                        } catch (e) {
                            await sock.sendMessage(from, { text: '> *〕Terjadi masalah pada server.*' }, { quoted: m })
                        }
                        break

                    case 'animfind':
                    case 'tt':
                    case 'ig':
                    case 'ytb':
                    case 'igstalk':
                    case 'ttstalk':
                    case 'rbxstalk':
                        await sock.sendMessage(from, { text: '> *〕Fitur dalam perbaikan.*' }, { quoted: m })
                        break

                    case 'self':
                        if (!isOwner) return
                        isPublic = false
                        await sock.sendMessage(from, { text: 'Mode Self' }, { quoted: m })
                        break

                    case 'public':
                        if (!isOwner) return
                        isPublic = true
                        await sock.sendMessage(from, { text: 'Mode Public' }, { quoted: m })
                        break
                }
            }
        } catch (e) {
            console.log(e)
        }
    })
}

startBot()


