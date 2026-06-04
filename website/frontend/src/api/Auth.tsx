export async function loadAuth(
    storedToken: string,
    API_BASE: string
) {
    const res = await fetch(`${API_BASE}/auth`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${storedToken}`,
        },
    });

    if (!res.ok) {
        throw new Error("UNAUTHORIZED");
    }

    return await res.json();
}

export async function login(username: string, password: string, API_BASE: string) {
    const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
        throw new Error("Login failed");
    }

    return await res.json();
}

export async function register(username: string, password: string, API_BASE: string) {
    const res = await fetch(`${API_BASE}/register`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
        throw new Error("Registration failed");
    }

    return await res.json();
}