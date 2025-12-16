import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface RefreshContextType {
    refreshTrigger: number;
    triggerRefresh: () => void;
}

const RefreshContext = createContext<RefreshContextType | undefined>(undefined);

export const RefreshProvider = ({ children }: { children: ReactNode }) => {
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const triggerRefresh = () => {
        setRefreshTrigger(prev => prev + 1);
    };

    return (
        <RefreshContext.Provider value={{ refreshTrigger, triggerRefresh }}>
            {children}
        </RefreshContext.Provider>
    );
};

export const useRefresh = () => {
    const context = useContext(RefreshContext);
    if (!context) {
        throw new Error('useRefresh must be used within a RefreshProvider');
    }
    return context;
};
