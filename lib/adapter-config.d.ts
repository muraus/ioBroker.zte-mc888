// Makes the instance settings from admin/jsonConfig.json known to the type
// checker, so `this.config.<key>` is typed in main.js.

declare global {
    namespace ioBroker {
        interface AdapterConfig {
            ip: string;
            pollInterval: number;
            useLogin: boolean;
            user: string;
            password: string;
            webUiPriority: boolean;
            graceMinutes: number;
        }
    }
}

export {};
