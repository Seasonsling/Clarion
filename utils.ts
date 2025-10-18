export function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
}

export function getInitials(displayName: string): string {
    if (!displayName) return '?';
    displayName = displayName.trim();
    
    const isChinese = /[\u4e00-\u9fa5]/.test(displayName);

    if (isChinese) {
        return displayName.substring(0, 1);
    } else {
        const parts = displayName.split(' ').filter(p => p);
        if (parts.length > 1) {
            return parts[parts.length - 1].substring(0, 1).toUpperCase();
        } else if (parts.length === 1 && parts[0].length > 0) {
            return parts[0].substring(0, 1).toUpperCase();
        }
    }
    return '?';
}

export function decodeJwtPayload(token: string): any {
    try {
        const base64Url = token.split('.')[1];
        if (!base64Url) return null;
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split('')
                .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error("Failed to decode JWT payload:", e);
        return null;
    }
}

export function parseDate(dateString: string | undefined): Date | null {
    if (!dateString) return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
}

export function getWeekStartDate(d: Date): Date {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
}

export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result as string;
            // The result includes the data URL prefix (e.g., "data:image/png;base64,"),
            // which needs to be removed for the API.
            resolve(base64String.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
