import { spawn } from 'child_process';
import path from 'path';

export class CppEngine {
    private static getExecutablePath() {
        return process.env.CPP_ENGINE_PATH || path.resolve(__dirname, '../../../cpp-core/build/Debug/clinicqueue-engine.exe');
    }

    static async execute(operation: string, payload: any): Promise<any> {
        let op = operation;
        let p = payload;

        // Alias compatibility: translate computeAvailableSlots to generateSlots
        if (op === 'computeAvailableSlots') {
            op = 'generateSlots';
            const sched = payload.schedule || {};
            p = {
                startTime: sched.startTime || payload.startTime || "09:00",
                endTime: sched.endTime || payload.endTime || "17:00",
                lunchStart: sched.lunchStart || payload.lunchStart || "13:00",
                lunchEnd: sched.lunchEnd || payload.lunchEnd || "14:00",
                slotDurationMinutes: sched.slotDurationMinutes || payload.slotDurationMinutes || 20,
                workingDays: sched.workingDays || payload.workingDays || [1, 2, 3, 4, 5, 6],
                bookedSlots: payload.bookedSlots || [],
                targetDate: payload.date || payload.targetDate || new Date().toISOString().split('T')[0],
                nowUtc: new Date().toISOString()
            };
        }

        return new Promise((resolve, reject) => {
            const enginePath = this.getExecutablePath();
            const childProcess = spawn(enginePath, []);

            let stdoutData = '';
            let stderrData = '';

            childProcess.stdout.on('data', (data) => {
                stdoutData += data.toString();
            });

            childProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
            });

            childProcess.on('close', (code) => {
                if (code !== 0) {
                    return reject(new Error(`C++ Engine exited with code ${code}. Stderr: ${stderrData}`));
                }
                try {
                    const result = JSON.parse(stdoutData);
                    if (!result.ok) {
                        return reject(new Error(result.error || 'Unknown C++ Engine error'));
                    }
                    resolve(result);
                } catch (e) {
                    reject(new Error(`Failed to parse C++ Engine output: ${stdoutData}`));
                }
            });

            const requestJson = JSON.stringify({ operation: op, payload: p });
            childProcess.stdin.write(requestJson + '\n');
            childProcess.stdin.end();
            
            // Timeout to prevent hanging
            const timeoutMs = parseInt(process.env.CPP_ENGINE_TIMEOUT_MS || '5000', 10);
            setTimeout(() => {
                childProcess.kill();
                reject(new Error('C++ Engine execution timed out'));
            }, timeoutMs);
        });
    }
}
