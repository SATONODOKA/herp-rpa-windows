const fs = require('fs');
const path = require('path');
const config = require('../../config/app.json');

/**
 * 自動クリーンアップユーティリティ
 * 設定に基づいて古いファイルを削除・アーカイブする
 */
class AutoCleanup {
    constructor() {
        this.config = config.retention;
        this.folders = config.folders;
    }

    /**
     * ファイルの経過時間を取得
     */
    getFileAge(filePath) {
        const stats = fs.statSync(filePath);
        const now = new Date();
        const created = new Date(stats.birthtime);
        const ageInMs = now - created;
        return {
            hours: ageInMs / (1000 * 60 * 60),
            days: ageInMs / (1000 * 60 * 60 * 24)
        };
    }

    /**
     * Windows対応：ファイル削除のリトライ機構
     */
    async deleteFileWithRetry(filePath, maxRetries = 3, delay = 1000) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                fs.unlinkSync(filePath);
                return true;
            } catch (error) {
                if (error.code === 'EBUSY' || error.code === 'ENOENT') {
                    if (i === maxRetries - 1) {
                        console.warn(`[CLEANUP] Failed to delete after ${maxRetries} attempts: ${filePath}`);
                        return false;
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw error;
            }
        }
        return false;
    }

    /**
     * 一時ファイルのクリーンアップ（24時間後）
     */
    async cleanupTempFiles() {
        const tempPath = path.join(__dirname, '../../', this.folders.output.temp);
        if (!fs.existsSync(tempPath)) return;

        const files = fs.readdirSync(tempPath);
        let deletedCount = 0;

        for (const file of files) {
            const filePath = path.join(tempPath, file);
            const age = this.getFileAge(filePath);
            
            if (age.hours > this.config.output.temp.hours) {
                const success = await this.deleteFileWithRetry(filePath);
                if (success) {
                    deletedCount++;
                    console.log(`[CLEANUP] Deleted temp file: ${file} (${age.hours.toFixed(1)} hours old)`);
                }
            }
        }

        if (deletedCount > 0) {
            console.log(`[CLEANUP] Removed ${deletedCount} temporary files`);
        }
    }

    /**
     * 失敗ファイルのクリーンアップ（7日後）
     */
    async cleanupFailedFiles() {
        const failedPath = path.join(__dirname, '../../', this.folders.output.failed);
        if (!fs.existsSync(failedPath)) return;

        const files = fs.readdirSync(failedPath);
        let deletedCount = 0;

        for (const file of files) {
            const filePath = path.join(failedPath, file);
            const age = this.getFileAge(filePath);
            
            if (age.days > this.config.output.failed.days) {
                const success = await this.deleteFileWithRetry(filePath);
                if (success) {
                    deletedCount++;
                    console.log(`[CLEANUP] Deleted failed file: ${file} (${age.days.toFixed(1)} days old)`);
                }
            }
        }

        if (deletedCount > 0) {
            console.log(`[CLEANUP] Removed ${deletedCount} failed processing files`);
        }
    }

    /**
     * 成功ファイルのアーカイブ（30日後）
     */
    archiveSuccessFiles() {
        const successPath = path.join(__dirname, '../../', this.folders.output.success);
        const archivePath = path.join(__dirname, '../../', this.folders.archive);
        
        if (!fs.existsSync(successPath)) return;
        if (!fs.existsSync(archivePath)) {
            fs.mkdirSync(archivePath, { recursive: true });
        }

        const files = fs.readdirSync(successPath);
        let archivedCount = 0;

        files.forEach(file => {
            const filePath = path.join(successPath, file);
            const age = this.getFileAge(filePath);
            
            if (age.days > this.config.output.success.days) {
                // 年月フォルダを作成
                const date = new Date(fs.statSync(filePath).birthtime);
                const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                const archiveSubPath = path.join(archivePath, yearMonth);
                
                if (!fs.existsSync(archiveSubPath)) {
                    fs.mkdirSync(archiveSubPath, { recursive: true });
                }

                const newPath = path.join(archiveSubPath, file);
                fs.renameSync(filePath, newPath);
                archivedCount++;
                console.log(`[ARCHIVE] Moved to archive: ${file} → ${yearMonth}/`);
            }
        });

        if (archivedCount > 0) {
            console.log(`[ARCHIVE] Archived ${archivedCount} success files`);
        }
    }

    /**
     * プロセスログのアーカイブ（90日後）
     */
    archiveProcessLogs() {
        const logPath = path.join(__dirname, '../../', this.folders.logs.process);
        const archivePath = path.join(__dirname, '../../', this.folders.archive, 'logs');
        
        if (!fs.existsSync(logPath)) return;
        if (!fs.existsSync(archivePath)) {
            fs.mkdirSync(archivePath, { recursive: true });
        }

        const files = fs.readdirSync(logPath);
        let archivedCount = 0;

        files.forEach(file => {
            const filePath = path.join(logPath, file);
            const age = this.getFileAge(filePath);
            
            if (age.days > this.config.logs.process.days) {
                const newPath = path.join(archivePath, file);
                fs.renameSync(filePath, newPath);
                archivedCount++;
                console.log(`[ARCHIVE] Archived log: ${file}`);
            }
        });

        if (archivedCount > 0) {
            console.log(`[ARCHIVE] Archived ${archivedCount} log files`);
        }
    }

    /**
     * すべてのクリーンアップを実行
     */
    async runAll() {
        console.log('=== Starting Auto Cleanup ===');
        console.log(`Time: ${new Date().toISOString()}`);
        
        try {
            await this.cleanupTempFiles();
            await this.cleanupFailedFiles();
            this.archiveSuccessFiles();
            this.archiveProcessLogs();
            console.log('=== Cleanup Completed Successfully ===');
        } catch (error) {
            console.error('[ERROR] Cleanup failed:', error);
        }
    }

    /**
     * 定期実行の設定（1日1回）
     */
    scheduleDaily() {
        // 毎日午前2時に実行
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(2, 0, 0, 0);
        
        const msUntilTomorrow = tomorrow - now;
        
        setTimeout(async () => {
            await this.runAll();
            // 次の実行を24時間後にスケジュール
            setInterval(async () => await this.runAll(), 24 * 60 * 60 * 1000);
        }, msUntilTomorrow);
        
        console.log(`[SCHEDULER] Auto cleanup scheduled for ${tomorrow.toISOString()}`);
    }
}

// コマンドラインから直接実行された場合
if (require.main === module) {
    const cleanup = new AutoCleanup();
    
    // コマンドライン引数をチェック
    const args = process.argv.slice(2);
    
    if (args.includes('--schedule')) {
        cleanup.scheduleDaily();
    } else {
        cleanup.runAll().catch(console.error);
    }
}

module.exports = AutoCleanup;