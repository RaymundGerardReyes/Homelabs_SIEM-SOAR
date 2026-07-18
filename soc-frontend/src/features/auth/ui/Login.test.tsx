import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from './Login';
import { describe, it, expect } from 'vitest';

describe('Login Component', () => {
  it('renders the login interface correctly', () => {
    render(<Login />);
    
    // Verify logo and title exist
    expect(screen.getByText('Agentic SOC Platform')).toBeInTheDocument();
    expect(screen.getByText('Advanced Multi-Tenant SIEM & SOAR')).toBeInTheDocument();
    
    // Verify the login button exists
    const loginButton = screen.getByRole('button', { name: /Sign in with Corporate Google/i });
    expect(loginButton).toBeInTheDocument();
  });

  it('triggers the OAuth redirect when clicking the sign-in button', async () => {
    // Mock window.location.href assignment
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    });

    render(<Login />);
    
    const user = userEvent.setup();
    const loginButton = screen.getByRole('button', { name: /Sign in with Corporate Google/i });
    
    await user.click(loginButton);

    // Verify the browser is redirected to the backend OAuth endpoint
    expect(window.location.href).toBe('/api/auth/google/login');

    // Restore original location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });
});
