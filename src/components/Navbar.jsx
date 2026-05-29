export default function Navbar({ onLogout }) {
  return (
    <header className="navbar">
      <a className="navbar-brand" href="#home">India Warehousing Survey</a>
      <nav className="navbar-links" aria-label="Main navigation">
        <a href="#home">Home</a>
        {onLogout && (
          <button
            id="navbar-logout-btn"
            onClick={onLogout}
            style={{
              background: 'none',
              border: '1px solid currentColor',
              color: 'inherit',
              cursor: 'pointer',
              padding: '0.25rem 0.75rem',
              borderRadius: '4px',
              fontSize: '0.875rem',
              marginLeft: '0.5rem',
            }}
            aria-label="Log out"
          >
            Log out
          </button>
        )}
      </nav>
    </header>
  );
}
