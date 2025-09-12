const express = require('express');
const puppeteer = require('puppeteer');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

let browser = null;
let page = null;
let sseClients = [];

app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    sseClients.push(res);
    
    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
    });
});

function sendEvent(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => client.write(message));
}

function sendLog(message, level = 'info') {
    sendEvent({ type: 'log', message, level });
}

app.post('/upload', upload.single('jsonFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'JSONファイルがアップロードされていません' });
    }
    
    try {
        const jsonData = fs.readFileSync(req.file.path, 'utf8');
        const parsedData = JSON.parse(jsonData);
        
        fs.unlinkSync(req.file.path);
        
        res.json({ 
            message: 'JSONファイルが正常にアップロードされました',
            data: parsedData 
        });
    } catch (error) {
        res.status(400).json({ error: 'JSONファイルの解析に失敗しました' });
    }
});

app.post('/execute', async (req, res) => {
    try {
        const { data } = req.body;
        
        if (!data || !data.name) {
            sendLog('JSONデータに求人名が含まれていません', 'error');
            return res.status(400).json({ error: 'JSONデータに求人名が含まれていません' });
        }
        
        const inputJobName = data.name;
        sendLog(`判定する求人名: ${inputJobName}`);
        sendLog('ブラウザを起動しています...');
        
        if (browser) {
            await browser.close();
        }
        
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: ['--start-maximized']
        });
        
        sendLog('新しいページを作成しています...');
        page = await browser.newPage();
        
        sendLog('指定のURLにアクセスしています...');
        await page.goto('https://agent.herp.cloud/p/HO3nC9noAkwOgXlKbC-hDeewP8nK4yQlrT2OnkN2XTw', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        sendLog('ページの読み込みが完了しました', 'success');
        
        sendLog('募集職種一覧を取得しています...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 「この職種に推薦する」ボタンと対応する求人名のみを取得
        const jobListings = await page.evaluate(() => {
            const jobs = [];
            
            // 「この職種に推薦する」ボタンを含む要素を探す
            const recommendationButtons = document.querySelectorAll('button');
            const validButtons = Array.from(recommendationButtons).filter(btn => 
                btn.textContent && btn.textContent.includes('この職種に推薦する')
            );
            
            console.log(`推薦ボタンを${validButtons.length}個見つけました`);
            
            validButtons.forEach((button, index) => {
                // ボタンの親要素から対応する求人名を探す
                let currentElement = button;
                let jobName = null;
                
                // 上位の要素を辿って求人名を探す
                for (let i = 0; i < 10; i++) {
                    currentElement = currentElement.parentElement;
                    if (!currentElement) break;
                    
                    // 求人名が含まれていそうなセルを探す
                    const nameCell = currentElement.querySelector('.agent-requisitions-table-list__cell.--name');
                    if (nameCell) {
                        const anchor = nameCell.querySelector('a');
                        if (anchor && anchor.textContent) {
                            jobName = anchor.textContent.trim();
                            break;
                        }
                    }
                    
                    // 別の方法：テーブル行の最初の列を探す
                    const firstCell = currentElement.querySelector('td:first-child');
                    if (firstCell) {
                        const anchor = firstCell.querySelector('a');
                        if (anchor && anchor.textContent) {
                            jobName = anchor.textContent.trim();
                            break;
                        }
                    }
                }
                
                if (jobName && !jobs.includes(jobName)) {
                    jobs.push(jobName);
                }
            });
            
            return jobs;
        });
        
        sendLog(`${jobListings.length}件の募集職種を取得しました`);
        sendLog('募集職種一覧: ' + jobListings.join(', '));
        
        sendLog(`照合中: ${inputJobName}`);
        
        let matchedJob = null;
        let matchType = null;
        
        // 完全一致をチェック
        const exactMatch = jobListings.find(job => 
            job.toLowerCase() === inputJobName.toLowerCase()
        );
        
        if (exactMatch) {
            matchedJob = exactMatch;
            matchType = 'exact';
            sendLog(`完全一致: ${inputJobName} → ${exactMatch}`, 'success');
        } else {
            // 部分一致をチェック（双方向）
            const partialMatch = jobListings.find(job => {
                const jobLower = job.toLowerCase();
                const inputLower = inputJobName.toLowerCase();
                
                // 募集職種名に入力文字が含まれる（例: 「インサイドセ」→「インサイドセールス」）
                if (jobLower.includes(inputLower)) {
                    return true;
                }
                
                // 入力文字に募集職種名が含まれる（例: 「マネジャー候補インサイドセールス」→「インサイドセールス」）
                if (inputLower.includes(jobLower)) {
                    return true;
                }
                
                return false;
            });
            
            if (partialMatch) {
                matchedJob = partialMatch;
                matchType = 'partial';
                
                const jobLower = partialMatch.toLowerCase();
                const inputLower = inputJobName.toLowerCase();
                
                if (jobLower.includes(inputLower)) {
                    sendLog(`部分一致: 「${inputJobName}」が「${partialMatch}」に含まれています`, 'success');
                } else if (inputLower.includes(jobLower)) {
                    sendLog(`部分一致: 「${partialMatch}」が「${inputJobName}」に含まれています`, 'success');
                }
            } else {
                matchType = 'none';
                sendLog(`該当なし: ${inputJobName}に一致する募集職種が見つかりませんでした`, 'error');
            }
        }
        
        const result = {
            inputJobName,
            matchedJob,
            matchType,
            availableJobs: jobListings
        };
        
        sendEvent({ type: 'result', result });
        sendLog('判定処理が完了しました', 'success');
        sendEvent({ type: 'complete' });
        
        res.json({ 
            message: '判定が完了しました',
            result 
        });
        
    } catch (error) {
        console.error('Error:', error);
        sendLog(`エラーが発生しました: ${error.message}`, 'error');
        res.status(500).json({ error: 'ブラウザの起動に失敗しました: ' + error.message });
    }
});

app.post('/close', async (req, res) => {
    try {
        if (browser) {
            await browser.close();
            browser = null;
            page = null;
            sendLog('ブラウザを終了しました');
        }
        res.json({ message: 'ブラウザを閉じました' });
    } catch (error) {
        res.status(500).json({ error: 'ブラウザの終了に失敗しました' });
    }
});

app.listen(port, () => {
    console.log(`RPAツールが http://localhost:${port} で起動しました`);
});

process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});