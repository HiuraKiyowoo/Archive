/**
 * ANIME LOVERS
 * Author : Gienetic
 * Base   : https://play.google.com/store/apps/details?id=com.aniverseid.animelovers
 * Note : Kaya nya dev apk nya orang indo (mungkin diantara kita :v), maaf ya bang , anggap aja sebagai pengujian apk nya
 sekali lagi maaf ya puh
 */
 

const axios = require('axios');
const crypto = require('crypto');
const readline = require('readline');
const fs = require('fs');

const API_URL = 'https://apps.animekita.org/api/v1.2.5';

// ==========================================
// CORE ENGINE
// ==========================================

const getHeaders = (isFlutter = false, isPost = false) => {
    const headers = {
        'accept': 'application/json',
        'accept-encoding': 'gzip',
        'host': 'apps.animekita.org',
        'access-control-allow-origin': '*',
        'user-agent': isFlutter ? 'Flutter/2.5.3' : 'Dart/3.9 (dart:io)'
    };
    if (isPost) headers['content-type'] = 'text/plain; charset=utf-8';
    return headers;
};

const loginGuest = async () => {
    const uid = crypto.randomBytes(5).toString('hex');
    const payload = { user: `Guest_${uid}`, email: `gienetic_${uid}@gmail.com`, profil: "https://lh3.googleusercontent.com/a/default" };
    try {
        const res = await axios.post(`${API_URL}/model/login.php`, JSON.stringify(payload), { headers: getHeaders(false, true) });
        return res.data?.data?.[0]?.token || null;
    } catch (err) { return null; }
};

const getRekomendasi = async () => {
    try {
        const res = await axios.get(`${API_URL}/rekomendasi.php`, { headers: getHeaders() });
        return res.data || [];
    } catch (err) { return []; }
};

const getOngoing = async (page = 1) => {
    try {
        const res = await axios.get(`${API_URL}/home/ongoing.php`, { headers: getHeaders(), params: { page, type: 'all' } });
        return res.data || [];
    } catch (err) { return []; }
};

const getBaruUpload = async (page = 1) => {
    try {
        const res = await axios.get(`${API_URL}/baruupload.php`, { headers: getHeaders(), params: { page } });
        return res.data || [];
    } catch (err) { return []; }
};

const getMovie = async (page = 1) => {
    try {
        const res = await axios.get(`${API_URL}/movie.php`, { headers: getHeaders(), params: { page } });
        return res.data || [];
    } catch (err) { return []; }
};

// Fungsi Baru: Mendapatkan Jadwal Rilis Mingguan
const getJadwal = async () => {
    try {
        // Method POST, tapi payload kosong sesuai capture
        const res = await axios.post(`${API_URL}/jadwal.php`, "", { headers: getHeaders(false, true) });
        return res.data?.data || [];
    } catch (err) { return []; }
};

const searchAnime = async (keyword, page = 1) => {
    try {
        const res = await axios.get(`${API_URL}/search.php`, { headers: getHeaders(), params: { keyword, page, per_page: 20 } });
        return res.data?.data?.[0] || null;
    } catch (err) { return null; }
};

const getSeriesDetail = async (seriesSlug, token = "") => {
    const payload = { get: "top", post_type: "1", post_id: seriesSlug, token };
    try {
        const res = await axios.post(`${API_URL}/series.php?url=${seriesSlug}`, JSON.stringify(payload), { headers: getHeaders(false, true) });
        return res.data?.data?.[0] || null;
    } catch (err) { return null; }
};

const getStreamLinks = async (postId, seriesSlug, episode, token) => {
    const payload = { post_type: "2", post_id: postId, series_id: seriesSlug, series_url: seriesSlug, episode: episode.toString(), token };
    try {
        const res = await axios.post(`${API_URL}/series/episode/data.php?url=${postId}`, JSON.stringify(payload), { headers: getHeaders(true, true) });
        return res.data?.data?.[0]?.streams || null;
    } catch (err) { return null; }
};

module.exports = {
    loginGuest,
    getRekomendasi,
    getOngoing,
    getBaruUpload,
    getMovie,
    getJadwal,
    searchAnime,
    getSeriesDetail,
    getStreamLinks
};

// ==========================================
// CLI ENGINE
// ==========================================

if (require.main === module) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((resolve) => rl.question(`? ${q}`, resolve));
    
    let sessionToken = null;

    const saveAndPrintJSON = (filename, data) => {
        const jsonString = JSON.stringify(data, null, 2);
        console.log(`\n=== OUTPUT JSON ===\n${jsonString}\n===================`);
        try {
            fs.writeFileSync(filename, jsonString);
            console.log(`[+] File tersimpan: ${filename}`);
        } catch (e) {
            console.log(`[-] Gagal menyimpan file: ${e.message}`);
        }
    };

    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    const fetchSmart = async (fetchFn, typeName, ...args) => {
        let allData = [];
        let seenIds = new Set();
        let page = 1;
        let keepFetching = true;

        console.log(`\n[*] Mengekstrak data ${typeName}...`);
        
        while (keepFetching) {
            process.stdout.write(`[~] Fetching page ${page}... `);
            const data = await fetchFn(...args, page);
            
            let items = [];
            let hasNextPage = true;

            if (data && data.result) {
                items = data.result;
                hasNextPage = data.pagination ? data.pagination.has_next : false;
            } else if (Array.isArray(data)) {
                items = data;
            } else {
                console.log('ERROR FORMAT');
                break;
            }

            if (items.length === 0) {
                console.log('KOSONG (Mencapai batas akhir)');
                break;
            }

            let newItemsCount = 0;
            for (const item of items) {
                const uniqueKey = item.id || item.url;
                if (!seenIds.has(uniqueKey)) {
                    seenIds.add(uniqueKey);
                    allData.push(item);
                    newItemsCount++;
                }
            }

            console.log(`OK (+${newItemsCount} data baru)`);

            if (newItemsCount === 0 || !hasNextPage) {
                keepFetching = false;
            } else {
                page++;
                await delay(800); 
            }
        }

        console.log(`[+] Total Data Bersih: ${allData.length} item.`);
        if (allData.length > 0) {
            saveAndPrintJSON(`${typeName.replace(/\s/g, '_').toLowerCase()}.json`, allData);
        }
    };

    const handleStreamExtraction = async () => {
        console.log('\n--- Ekstraksi Stream Video ---');
        const slug = await ask('Slug Anime (contoh: compass-20-sub-indo): ');
        if (!slug.trim()) return;

        process.stdout.write('[~] Memuat detail series... ');
        const detail = await getSeriesDetail(slug, sessionToken);
        
        if (!detail || !detail.chapter || detail.chapter.length === 0) {
            return console.log('\n[-] Gagal memuat atau anime belum memiliki episode.');
        }
        console.log('OK\n');

        const chapters = detail.chapter.sort((a, b) => parseInt(a.ch) - parseInt(b.ch));
        chapters.forEach(c => console.log(`Ep ${c.ch} \t| ID: ${c.url}`));

        const epSelected = await ask('\nPilih nomor episode: ');
        const targetChapter = chapters.find(c => c.ch === epSelected.trim());

        if (!targetChapter) return console.log('[-] Nomor episode tidak valid.');

        process.stdout.write(`[~] Mengekstrak stream Episode ${targetChapter.ch}... `);
        const streams = await getStreamLinks(targetChapter.url, slug, targetChapter.ch, sessionToken);

        if (!streams) return console.log('\n[-] Ekstraksi gagal atau link stream belum tersedia.');
        console.log('OK');

        saveAndPrintJSON(`stream_${slug}_ep${targetChapter.ch}.json`, streams);
    };

    const runCLI = async () => {
        console.clear();
        console.log("===================================");
        console.log("       ANIMELOVER CLI       ");
        console.log("===================================");
        
        process.stdout.write('\n[*] Inisiasi sesi anonim... ');
        sessionToken = await loginGuest();
        if (!sessionToken) {
            console.log('GAGAL KONEKSI');
            process.exit(1);
        }
        console.log('OK');

        while (true) {
            console.log('\n[ MAIN DASHBOARD ]');
            console.log('1. Fetch Rekomendasi');
            console.log('2. Fetch Ongoing (Ambil Semua)');
            console.log('3. Fetch Baru Upload (Ambil Semua)');
            console.log('4. Fetch List Movie (Ambil Semua)');
            console.log('5. Search Anime');
            console.log('6. Ekstrak Link Stream Video');
            console.log('7. Fetch Jadwal Rilis (Mingguan)'); // Menu Baru
            console.log('0. Keluar');

            const menu = await ask('\nPilihan: ');

            switch (menu.trim()) {
                case '1':
                    console.log('\n[*] Memuat rekomendasi...');
                    const rekData = await getRekomendasi();
                    console.log(`[+] Total: ${rekData.length} item.`);
                    if (rekData.length > 0) saveAndPrintJSON('rekomendasi.json', rekData);
                    break;
                case '2':
                    await fetchSmart(getOngoing, 'Ongoing');
                    break;
                case '3':
                    await fetchSmart(getBaruUpload, 'Baru Upload');
                    break;
                case '4':
                    await fetchSmart(getMovie, 'Movie List');
                    break;
                case '5':
                    const kw = await ask('Masukkan Kata Kunci: ');
                    if (kw.trim()) await fetchSmart((kw, page) => searchAnime(kw, page), `Search_${kw}`, kw);
                    break;
                case '6':
                    await handleStreamExtraction();
                    break;
                case '7':
                    console.log('\n[*] Memuat jadwal rilis mingguan...');
                    const jadwalData = await getJadwal();
                    if (jadwalData && jadwalData.length > 0) {
                        console.log(`[+] Jadwal ditemukan untuk ${jadwalData.length} hari.`);
                        jadwalData.forEach(hari => {
                            console.log(`    - ${hari.day} (${hari.date}): ${hari.animeList?.length || 0} Judul Anime`);
                        });
                        saveAndPrintJSON('jadwal_rilis.json', jadwalData);
                    } else {
                        console.log('[-] Data jadwal kosong atau gagal dimuat.');
                    }
                    break;
                case '0':
                    console.log('\n[!] Terminated.');
                    rl.close();
                    return;
                default:
                    console.log('[-] Pilihan tidak valid.');
            }
        }
    };

    runCLI();
}
