import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UsersAPI, ProjectsAPI, API_CONFIG } from '../services/api';
import { useNavigate } from 'react-router-dom';
import styles from './Settings.module.css';

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');
  
  // Profile state
  const [name, setName] = useState(user?.name || '');
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  
  // Projects state
  const [projects, setProjects] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingProjectId, setDeletingProjectId] = useState(null);
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState(null);
  
  // Appearance state
  const [accentColor, setAccentColor] = useState('#00c8f8');
  
  // Danger zone state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const backendOrigin = API_CONFIG.BASE_URL.replace(/\/api\/?$/, '');

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const userProjects = await ProjectsAPI.getUserProjects();
      setProjects(userProjects || []);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  const handleDeleteProject = async (projectId) => {
    setDeletingProjectId(projectId);
    try {
      await ProjectsAPI.delete(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
    } catch (err) {
      console.error('Failed to delete project:', err);
    } finally {
      setDeletingProjectId(null);
      setConfirmDeleteProjectId(null);
    }
  };

  const handleOpenProject = (projectId) => {
    ProjectsAPI.openInApp(projectId);
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileMessage('');
    try {
      await UsersAPI.update({ name });
      setProfileMessage('Profile updated successfully');
      setTimeout(() => setProfileMessage(''), 3000);
    } catch (err) {
      setProfileError(err.message);
    }
  };

  const projectThumbSrc = (p) => {
    const t = p?.thumbnail;
    if (!t) return null;
    if (typeof t !== 'string') return null;
    if (t.startsWith('http://') || t.startsWith('https://')) return t;
    if (t.startsWith('/')) return `${backendOrigin}${t}`;
    return `${backendOrigin}/${t}`;
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleDeleteAccount = async () => {
    setDeleteError('');
    if (!deletePassword) {
      setDeleteError('Password is required');
      return;
    }
    
    setDeleting(true);
    try {
      await UsersAPI.delete(deletePassword);
      await logout();
      navigate('/login');
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete account');
    } finally {
      setDeleting(false);
    }
  };

  const filteredProjects = projects.filter(p => 
    p.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderTab = () => {
    switch (activeTab) {
      case 'profile':
        return (
          <div className={styles.tabContent}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>Profile Settings</h2>
              <p className={styles.panelSub}>Manage your personal information</p>
            </div>
            <form onSubmit={handleUpdateProfile} className={styles.form}>
              <div className={styles.avatarSection}>
                <div className={styles.avatarLarge}>
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className={styles.avatarInfo}>
                  <div className={styles.avatarName}>{user?.name || 'User'}</div>
                  <div className={styles.avatarEmail}>{user?.email}</div>
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Display Name</label>
                <div className={styles.inputWrap}>
                  <svg className={styles.inputIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.3"/>
                  </svg>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className={styles.input}
                  />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Email</label>
                <div className={styles.inputWrap}>
                  <svg className={styles.inputIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="4" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M2 6l6 3 6-3" stroke="currentColor" strokeWidth="1.3"/>
                  </svg>
                  <input
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className={styles.input}
                  />
                </div>
              </div>
              <button type="submit" className={styles.primaryBtn}>Save Changes</button>
              {profileMessage && <div className={styles.success}>{profileMessage}</div>}
              {profileError && <div className={styles.error}>{profileError}</div>}
            </form>
          </div>
        );

      case 'projects':
        return (
          <div className={styles.tabContent}>
            <div className={styles.panelHeader}>
              <div className={styles.panelHeaderRow}>
                <div>
                  <h2 className={styles.panelTitle}>My Projects</h2>
                  <p className={styles.panelSub}>All your saved network designs</p>
                </div>
                <button onClick={() => navigate('/designer')} className={styles.newProjectBtn}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  New Design
                </button>
              </div>
            </div>
            <div className={styles.searchWrap}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search projects…"
                className={styles.searchInput}
              />
            </div>
            {filteredProjects.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>
                  <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                    <rect x="6" y="10" width="32" height="26" rx="3" stroke="#243558" strokeWidth="1.5" strokeDasharray="4 3"/>
                  </svg>
                </div>
                <div className={styles.emptyTitle}>No projects yet</div>
                <div className={styles.emptySub}>Open the designer, build a network, then hit Save to store it here.</div>
              </div>
            ) : (
              <div className={styles.projectsGrid}>
                {filteredProjects.map(project => (
                  <div key={project.id} className={styles.projectCard}>
                    {/* Thumbnail — clickable to open */}
                    <div
                      className={styles.projectThumbWrap}
                      onClick={() => handleOpenProject(project.id)}
                      title="Open in Designer"
                    >
                      {projectThumbSrc(project) ? (
                        <img className={styles.projectThumb} src={projectThumbSrc(project)} alt={project.name} />
                      ) : (
                        <div className={styles.projectThumbEmpty}>
                          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                            <rect x="4" y="4" width="24" height="24" rx="3" stroke="rgba(0,200,248,0.2)" strokeWidth="1.5" strokeDasharray="4 3"/>
                            <path d="M16 20V12M12 16l4-4 4 4" stroke="rgba(0,200,248,0.3)" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        </div>
                      )}
                      <div className={styles.projectThumbOverlay}>
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                          <path d="M3 10h14M10 3l7 7-7 7" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span>Open</span>
                      </div>
                    </div>

                    <div className={styles.projectHeader}>
                      <h3
                        className={styles.projectName}
                        onClick={() => handleOpenProject(project.id)}
                        title="Open in Designer"
                      >
                        {project.name}
                      </h3>
                      {/* Confirm-delete inline */}
                      {confirmDeleteProjectId === project.id ? (
                        <div className={styles.deleteConfirm}>
                          <span className={styles.deleteConfirmText}>Delete?</span>
                          <button
                            className={styles.deleteConfirmYes}
                            disabled={deletingProjectId === project.id}
                            onClick={() => handleDeleteProject(project.id)}
                          >
                            {deletingProjectId === project.id ? '…' : 'Yes'}
                          </button>
                          <button
                            className={styles.deleteConfirmNo}
                            onClick={() => setConfirmDeleteProjectId(null)}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          className={styles.deleteProjectBtn}
                          title="Delete project"
                          onClick={() => setConfirmDeleteProjectId(project.id)}
                        >
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <path d="M2 3.5h9M4.5 3.5V2.5h4v1M5.5 5.5v4M7.5 5.5v4M3 3.5l.8 7h5.4l.8-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      )}
                    </div>

                    <div className={styles.projectMeta}>
                      <span>{project.type}</span>
                      <span>#{project.id}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'appearance':
        return (
          <div className={styles.tabContent}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>Appearance</h2>
              <p className={styles.panelSub}>Customize the look and feel</p>
            </div>
            <div className={styles.form}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Accent Color</label>
                <div className={styles.colorPicker}>
                  {['#00c8f8', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899'].map(color => (
                    <button
                      key={color}
                      className={`${styles.colorOption} ${accentColor === color ? styles.colorActive : ''}`}
                      style={{ background: color }}
                      onClick={() => setAccentColor(color)}
                    >
                      {accentColor === color && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M3 7l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.previewBox} style={{ borderColor: accentColor }}>
                <div className={styles.previewText} style={{ color: accentColor }}>Preview</div>
              </div>
            </div>
          </div>
        );

      case 'about':
        return (
          <div className={styles.tabContent}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>About NetArch AI</h2>
              <p className={styles.panelSub}>Application information</p>
            </div>
            <div className={styles.aboutCard}>
              <div className={styles.aboutLogo}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                  <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke="#00c8f8" strokeWidth="1.5" fill="none"/>
                  <circle cx="12" cy="12" r="3" fill="#00c8f8" opacity="0.8"/>
                </svg>
              </div>
              <h3 className={styles.aboutTitle}>NetArch AI</h3>
              <div className={styles.aboutVersion}>Version 1.0.0</div>
              <p className={styles.aboutDesc}>
                Intelligent network design powered by AI. Upload floor plans, detect rooms automatically, and generate optimal network topologies.
              </p>
              <div className={styles.featuresList}>
                <div className={styles.featureItem}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="#10b981" strokeWidth="1.3"/>
                    <path d="M5 8l2 2 4-4" stroke="#10b981" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>AI-powered room detection</span>
                </div>
                <div className={styles.featureItem}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="#10b981" strokeWidth="1.3"/>
                    <path d="M5 8l2 2 4-4" stroke="#10b981" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>Automatic network topology generation</span>
                </div>
                <div className={styles.featureItem}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="#10b981" strokeWidth="1.3"/>
                    <path d="M5 8l2 2 4-4" stroke="#10b981" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>Drag-and-drop device placement</span>
                </div>
                <div className={styles.featureItem}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="#10b981" strokeWidth="1.3"/>
                    <path d="M5 8l2 2 4-4" stroke="#10b981" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>Real-time canvas interactions</span>
                </div>
              </div>
            </div>
          </div>
        );

      case 'danger':
        return (
          <div className={styles.tabContent}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>Danger Zone</h2>
              <p className={styles.panelSub}>Irreversible and destructive actions</p>
            </div>
            <div className={styles.dangerCard}>
              <div className={styles.dangerHeader}>
                <div>
                  <h3 className={styles.dangerTitle}>Delete Account</h3>
                  <p className={styles.dangerDesc}>
                    This will permanently delete your account and all associated data. This action cannot be undone.
                  </p>
                </div>
                <svg width="32" height="32" viewBox="0 0 14 14" fill="none" className={styles.dangerIcon}>
                  <path d="M7 1.5L12.5 11H1.5L7 1.5Z" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M7 5.5v3" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round"/>
                  <circle cx="7" cy="9.5" r="0.7" fill="#ef4444"/>
                </svg>
              </div>
              <button onClick={() => setShowDeleteModal(true)} className={styles.dangerBtn}>
                Delete My Account
              </button>
            </div>
            <div className={styles.dangerCard}>
              <div className={styles.dangerHeader}>
                <div>
                  <h3 className={styles.dangerTitle}>Sign Out</h3>
                  <p className={styles.dangerDesc}>
                    Log out of your account and return to the login page.
                  </p>
                </div>
              </div>
              <button onClick={handleLogout} className={styles.logoutBtn}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5 2H2.5A1.5 1.5 0 0 0 1 3.5v7A1.5 1.5 0 0 0 2.5 12H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M9 4l3 3-3 3M5 7h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Logout
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className={styles.settingsPage}>
      <header className={styles.settingsHeader}>
        <div className={styles.headerLogo}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke="#00c8f8" strokeWidth="1.5" fill="none"/>
            <circle cx="12" cy="12" r="3" fill="#00c8f8" opacity="0.8"/>
          </svg>
          <span className={styles.headerLogoText}>NetArch<span className={styles.headerLogoAccent}>AI</span></span>
          <span className={styles.headerPageLabel}>/ Settings</span>
        </div>
        <div className={styles.headerRight}>
          {user?.role === 'admin' && (
            <button onClick={() => navigate('/dashboard')} className={styles.adminDashboardBtn}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <rect x="1.5" y="1.5" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2"/>
                <rect x="8" y="1.5" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2"/>
                <rect x="1.5" y="8" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2"/>
                <rect x="8" y="8" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
              Admin Dashboard
            </button>
          )}
          <button onClick={() => navigate('/designer')} className={styles.backBtn}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M8 2L4 6.5 8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to App
          </button>
          <button onClick={handleLogout} className={styles.headerLogoutBtn}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M5 2H2.5A1.5 1.5 0 0 0 1 3.5v7A1.5 1.5 0 0 0 2.5 12H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M9 4l3 3-3 3M5 7h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Logout
          </button>
        </div>
      </header>

      <div className={styles.settingsLayout}>
        <nav className={styles.settingsNav}>
          <div className={styles.navUser}>
            <div className={styles.navAvatar}>{user?.name?.charAt(0).toUpperCase() || 'U'}</div>
            <div className={styles.navUserInfo}>
              <div className={styles.navUserName}>{user?.name || 'User'}</div>
              <div className={styles.navUserEmail}>{user?.email}</div>
            </div>
          </div>

          <div className={styles.navSectionLabel}>ACCOUNT</div>
          <button className={`${styles.navItem} ${activeTab === 'profile' ? styles.navActive : ''}`} onClick={() => setActiveTab('profile')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M1.5 12c0-2.5 2.5-4.5 5.5-4.5s5.5 2 5.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Profile
          </button>

          <div className={styles.navSectionLabel}>PREFERENCES</div>
          <button className={`${styles.navItem} ${activeTab === 'projects' ? styles.navActive : ''}`} onClick={() => setActiveTab('projects')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="3" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M1.5 6h11" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4 1.5v3M10 1.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Projects
            <span className={styles.navBadge}>{projects.length}</span>
          </button>
          <button className={`${styles.navItem} ${activeTab === 'appearance' ? styles.navActive : ''}`} onClick={() => setActiveTab('appearance')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Appearance
          </button>

          <div className={styles.navSectionLabel}>SYSTEM</div>
          <button className={`${styles.navItem} ${activeTab === 'about' ? styles.navActive : ''}`} onClick={() => setActiveTab('about')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M7 6.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <circle cx="7" cy="4.5" r="0.8" fill="currentColor"/>
            </svg>
            About
          </button>
          <button className={`${styles.navItem} ${styles.navDanger} ${activeTab === 'danger' ? styles.navActive : ''}`} onClick={() => setActiveTab('danger')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1.5L12.5 11H1.5L7 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M7 5.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <circle cx="7" cy="9.5" r="0.7" fill="currentColor"/>
            </svg>
            Danger Zone
          </button>
        </nav>

        <div className={styles.settingsContent}>
          {renderTab()}
        </div>
      </div>

      {showDeleteModal && (
        <div className={styles.modalBackdrop} onClick={() => { setShowDeleteModal(false); setDeleteError(''); setDeletePassword(''); }}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>Delete Account?</div>
            <div className={styles.modalBody}>
              This will permanently delete your account and all data. This cannot be undone.
            </div>
            
            <div className={styles.field} style={{ marginTop: '16px' }}>
              <label className={styles.fieldLabel}>Enter your password to confirm</label>
              <div className={styles.inputWrap}>
                <svg className={styles.inputIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDeleteAccount()}
                  className={styles.input}
                  placeholder="Enter your password"
                  autoFocus
                />
              </div>
            </div>
            
            {deleteError && (
              <div className={styles.error} style={{ marginTop: '12px' }}>{deleteError}</div>
            )}
            
            <div className={styles.modalActions}>
              <button 
                className={styles.cancelBtn} 
                onClick={() => { setShowDeleteModal(false); setDeleteError(''); setDeletePassword(''); }}
                disabled={deleting}
              >
                Cancel
              </button>
              <button 
                className={styles.confirmDeleteBtn}
                onClick={handleDeleteAccount}
                disabled={deleting}
              >
                {deleting ? (
                  <>
                    <svg className={styles.spinner} width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
                      <path d="M7 2a5 5 0 0 1 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    Deleting...
                  </>
                ) : (
                  'Delete Account'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
