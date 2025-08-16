import fetch from "node-fetch";

class PM {
    static PM_KEYS = [
        "bxys4xxq6mdsutbz",
        "96tes52wphmxt7f5",
    ];
    static apikey = this.getKeys()[Math.floor(Math.random() * this.getKeys().length)];

    static checkPremiumizeRes(res = {}) {
        return res?.status === "success";
    }

    static getKeys() {
        return this.PM_KEYS;
    }
    
    static async checkAccount() {
        const url = `https://www.premiumize.me/api/account/info?apikey=${this.apikey}`;
        try {
            const res = await fetch(url, { timeout: 5000 });
            const data = await res.json();
            return this.checkPremiumizeRes(data);
        } catch (error) {
            console.error('Premiumize account check error:', error);
            return false;
        }
    }

    static async checkCached(hash = "") {
        if (!hash) return false;
        const url = `https://www.premiumize.me/api/cache/check?apikey=${this.apikey}&items[]=${hash}`;
        
        try {
            const res = await fetch(url, { timeout: 5000 });
            if (!res.ok) return false;
            
            const data = await res.json();
            return this.checkPremiumizeRes(data) && 
                   data.response?.some(item => item);
        } catch (error) {
            console.error('Premiumize cache check error:', error);
            return false;
        }
    }

    static async getDirectDl(hash = "") {
        if (!hash) return [];
        const url = `https://www.premiumize.me/api/transfer/directdl?apikey=${this.apikey}`;
        
        try {
            const form = new URLSearchParams();
            form.append("src", `magnet:?xt=urn:btih:${hash}`);
            
            const res = await fetch(url, {
                method: "POST",
                body: form,
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                timeout: 10000,
            });
            
            const data = await res.json();
            if (this.checkPremiumizeRes(data)) {
                return data.content || [];
            }
            
            console.error('Premiumize direct DL failed:', data.message || 'Unknown error');
            return [];
        } catch (error) {
            console.error('Premiumize direct DL error:', error);
            return [];
        }
    }
}

console.log(`ℹ️ Using Premiumize API key: ${PM.apikey.slice(0, 5)}...`);

export { PM };