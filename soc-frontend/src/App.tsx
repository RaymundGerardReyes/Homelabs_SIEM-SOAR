import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './App.css';
import { ProtectedRoute, Login } from '@/features/auth';

import { MainLayout } from '@/layouts';
import { InvestigationProvider } from '@/features/investigations';
import { PlaybookProvider } from '@/features/playbooks';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Secure Dashboard Routes Protected by Authentication Guards */}
        <Route element={<ProtectedRoute />}>
          <Route path="/*" element={
            <InvestigationProvider>
              <PlaybookProvider>
                <MainLayout />
              </PlaybookProvider>
            </InvestigationProvider>
          } />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
