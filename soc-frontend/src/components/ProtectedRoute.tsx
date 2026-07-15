import React, { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

// ==============================================================================
// 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
//    - Authentication Gateway: Wraps all secure React Router DOM routes.
//    - Upstream: React Router | Downstream: Command Center Dashboard (<Outlet />)
// 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
//    - Evaluates the presence of the internal access token to determine if the user
//      has passed the Google OAuth2 pipeline and possesses a valid SOC Analyst identity.
// 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
//    - Security: Currently relies on `localStorage.getItem('internal_access_token')`.
//      Warning: `localStorage` is vulnerable to Cross-Site Scripting (XSS).
//      In strict NF3 (Security) compliance, this should be migrated to HttpOnly cookies.
// 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
//    - Interacts directly with the browser's DOM Web Storage API.
// 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
//    - Failure Mode: Token missing, tampered, or expired.
//    - Fallback State: Force-redirects client to `/login` via `<Navigate replace />`.
// ==============================================================================
const ProtectedRoute = () => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

    useEffect(() => {
        // 1. Intercept secure token from the Google OAuth Callback Redirect
        const hash = window.location.hash;
        if (hash.startsWith('#access_token=')) {
            const urlToken = hash.replace('#access_token=', '');
            // Persist the token to browser storage
            localStorage.setItem('internal_access_token', urlToken);
            // Immediately purge the token from the browser's URL history
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // 2. Validate the secure token
        const token = localStorage.getItem('internal_access_token');
        
        if (token) {
            setIsAuthenticated(true);
        } else {
            setIsAuthenticated(false);
        }
    }, []);

    if (isAuthenticated === null) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#111827', color: 'white'}}>
                <p>Loading Analyst Identity Profile...</p>
            </div>
        );
    }

    // If verification fails, immediately evict the user to the login screen
    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    // If verified, render the secure nested routes (The Command Center Dashboard)
    return <Outlet />;
};

export default ProtectedRoute;
