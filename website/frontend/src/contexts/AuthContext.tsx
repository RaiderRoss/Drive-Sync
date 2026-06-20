import { createContext, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadAuth, login as loginApi, register as registerApi } from "../api/Auth";

interface AuthContextType {
    token: string | null;
    isAdmin: boolean | null;
    user_id: string | null;
    login: (username: string, password: string) => Promise<void>;
    register: (username: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE = "/api";

const isPublicPath = (pathname: string): boolean => {
    if (pathname === "/login" || pathname === "/register") return true;
    if (pathname.startsWith("/share/")) return true;
    return false;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const navigate = useNavigate();
    const currentPath = window.location.pathname;

    const [token, setToken] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    const hydrateAuth = async (authToken: string) => {
        const data = await loadAuth(authToken, API_BASE);
        setIsAdmin(data.isAdmin);
        setUserId(data.user);
    };

    const syncAuth = async (authToken: string) => {
        localStorage.setItem("token", authToken);
        setToken(authToken);

        await hydrateAuth(authToken);
        navigate("/files");
    };

    const login = async (username: string, password: string) => {
        const data = await loginApi(username, password, API_BASE);
        await syncAuth(data.token);
    };

    const register = async (username: string, password: string) => {
        const data = await registerApi(username, password, API_BASE);
        await syncAuth(data.token);
    };

    useEffect(() => {
        const storedToken = localStorage.getItem("token");

        if (!storedToken) {
            if (!isPublicPath(currentPath)) {
                navigate("/login");
            }
            return;
        }

        setToken(storedToken);

        const run = async () => {
            try {
                await hydrateAuth(storedToken);
            } catch {
                localStorage.removeItem("token");
                setToken(null);
                setIsAdmin(null);
                setUserId(null);
                if (!isPublicPath(currentPath)) {
                    navigate("/login");
                }
            }
        };

        run();
    }, [currentPath, navigate]);

    return (
        <AuthContext.Provider value={{ token, isAdmin, user_id: userId, login, register }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = (): AuthContextType => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
};

export default AuthProvider;