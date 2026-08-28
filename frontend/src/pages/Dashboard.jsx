import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { DashboardAPI } from '../services/api';
import { useNavigate } from 'react-router-dom';
import styles from './Dashboard.module.css';

const statItems = [
  { key: 'total_users', label: 'TOTAL USERS', icon: '◎', tone: 'cyan' },
  { key: 'total_projects', label: 'TOTAL PROJECTS', icon: '◫', tone: 'green' },
  { key: 'subscribed_accounts', label: 'SUBSCRIBED ACCOUNTS', icon: '◆', tone: 'orange' },
  { key: 'free_accounts', label: 'FREE ACCOUNTS', icon: '◇', tone: 'purple' },
];

function statusLabel(status) {
  return status ? status.toUpperCase() : 'DRAFT';
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedUserProjects, setSelectedUserProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [userPendingDelete, setUserPendingDelete] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [userSort, setUserSort] = useState('projects');

  useEffect(() => {
    let active = true;
    Promise.all([DashboardAPI.get(), DashboardAPI.users()]).then(([data, userData]) => {
      if (!active) return;
      setDashboard(data);
      setUsers(userData);
    }).catch(err => {
      if (active) setError(err.message || 'Unable to load dashboard');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const handleDeleteUser = async () => {
    if (!userPendingDelete || userPendingDelete.id === user?.id) return;
    setDeletingUserId(userPendingDelete.id);
    try {
      await DashboardAPI.deleteUser(userPendingDelete.id);
      setUsers(previous => previous.filter(item => item.id !== userPendingDelete.id));
      setDashboard(previous => {
        if (!previous?.statistics) return previous;

        const deletedUserHadSubscription = userPendingDelete.subscription?.active;
        return {
          ...previous,
          statistics: {
            ...previous.statistics,
            total_users: Math.max(0, (previous.statistics.total_users || 0) - 1),
            subscribed_accounts: Math.max(0, (previous.statistics.subscribed_accounts || 0) - (deletedUserHadSubscription ? 1 : 0)),
            free_accounts: Math.max(0, (previous.statistics.free_accounts || 0) - (deletedUserHadSubscription ? 0 : 1)),
            total_projects: Math.max(0, (previous.statistics.total_projects || 0) - (userPendingDelete.projects_count || 0)),
          },
        };
      });
      setUserPendingDelete(null);
    } catch (err) {
      setError(err.message || 'Unable to delete user');
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleSelectUser = async (account) => {
    if (selectedUser?.id === account.id) {
      setSelectedUser(null);
      setSelectedUserProjects([]);
      return;
    }

    setSelectedUser(account);
    setProjectsLoading(true);
    try {
      const data = await DashboardAPI.userProjects(account.id);
      setSelectedUserProjects(data.projects || []);
    } catch (err) {
      setError(err.message || 'Unable to load user projects');
      setSelectedUserProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const statistics = dashboard?.statistics || {};
  const projects = dashboard?.recent_projects || [];
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleUsers = users.filter(account => {
    if (!normalizedSearch) return true;
    return account.name?.toLowerCase().includes(normalizedSearch)
      || account.email?.toLowerCase().includes(normalizedSearch);
  }).sort((first, second) => {
    if (userSort === 'subscription') {
      return Number(second.subscription?.active) - Number(first.subscription?.active)
        || (second.projects_count || 0) - (first.projects_count || 0);
    }
    if (userSort === 'completed') {
      return (second.completed_projects_count || 0) - (first.completed_projects_count || 0)
        || (second.projects_count || 0) - (first.projects_count || 0);
    }
    return (second.projects_count || 0) - (first.projects_count || 0);
  });
  const visibleProjects = selectedUserProjects.filter(project => {
    if (!normalizedSearch) return true;
    return project.name?.toLowerCase().includes(normalizedSearch);
  });

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}><span className={styles.brandMark}>N</span><span>NETARCH</span></div>
        <div className={styles.adminBadge}><span /> ADMIN CONSOLE</div>
        <nav className={styles.nav}>
          <button className={`${styles.navItem} ${styles.active}`}><span>▦</span> Dashboard</button>
          <button className={styles.navItem} onClick={() => navigate('/settings')}><span>⚙</span> Settings</button>
          <button className={styles.navItem} onClick={() => navigate('/designer')}><span>＋</span> New design</button>
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.userChip}><div className={styles.avatar}>{user?.name?.charAt(0).toUpperCase() || 'A'}</div><div><strong>{user?.name || 'Administrator'}</strong><small>{user?.email || 'admin account'}</small></div></div>
          <button className={styles.logout} onClick={handleLogout}>↪ <span>Sign out</span></button>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div><p className={styles.eyebrow}>SYSTEM / ADMIN</p><h1>Dashboard</h1></div>
          <div className={styles.headerMeta}><span className={styles.liveDot} /> SYSTEM ONLINE <span className={styles.divider} /> {new Date().toLocaleDateString()}</div>
        </header>
        <div className={styles.dashboardSearch}>
          <span className={styles.searchIcon}>⌕</span>
          <input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search by user or project name..." aria-label="Search by user or project name" />
          {searchQuery && <button onClick={() => setSearchQuery('')} aria-label="Clear search">×</button>}
        </div>

        {loading && <div className={styles.notice}>LOADING SYSTEM DATA...</div>}
        {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

        {!loading && !error && <>
          <section className={styles.statsGrid}>
            {statItems.map(item => <div className={`${styles.statCard} ${styles[item.tone]}`} key={item.key}><div className={styles.statTop}><span>{item.label}</span><b>{item.icon}</b></div><strong>{statistics[item.key] ?? 0}</strong><div className={styles.statLine} /></div>)}
          </section>

          <section className={styles.contentGrid}>
            <div className={`${styles.panel} ${styles.usersPanel}`}>
              {!selectedUser ? <>
                <div className={styles.panelHeader}><div><p className={styles.eyebrow}>ACCOUNT MANAGEMENT</p><h2>Users</h2></div><div className={styles.userTools}><select value={userSort} onChange={event => setUserSort(event.target.value)} aria-label="Sort users"><option value="projects">MOST PROJECTS</option><option value="completed">MOST COMPLETED</option><option value="subscription">SUBSCRIBED FIRST</option></select><span className={styles.userCount}>{users.length} ACCOUNTS</span></div></div>
                <div className={styles.userTableHeader}><span>USER</span><span>ROLE</span><span>PROJECTS</span><span>SUBSCRIPTION</span><span>ACTION</span></div>
                <div className={styles.usersList}>{visibleUsers.length === 0 ? <div className={styles.emptySearch}>NO USERS MATCH YOUR SEARCH</div> : visibleUsers.map(account => <div className={styles.userRow} key={account.id}><button className={styles.userIdentity} onClick={() => handleSelectUser(account)} title="View user projects"><div className={styles.userAvatar}>{account.name?.charAt(0).toUpperCase() || 'U'}</div><div><strong>{account.name}</strong><small>{account.email}</small></div></button><span className={account.role === 'admin' ? styles.adminRole : styles.userRole}>{account.role}</span><span>{account.projects_count}</span><span className={account.subscription?.active ? styles.subActive : styles.subInactive}>{account.subscription?.active ? account.subscription.plan : 'FREE'}</span><button className={styles.deleteUser} disabled={account.id === user?.id || deletingUserId === account.id} onClick={() => setUserPendingDelete(account)}>{deletingUserId === account.id ? '...' : account.id === user?.id ? 'CURRENT' : 'DELETE'}</button></div>)}</div>
              </> : <>
                <div className={styles.panelHeader}><div><p className={styles.eyebrow}>ACTIVITY LOG</p><h2>Recent projects</h2><small className={styles.selectedUserLabel}>{selectedUser.name}</small></div><button className={styles.textButton} onClick={() => { setSelectedUser(null); setSelectedUserProjects([]); }}>ALL USERS <span>→</span></button></div>
                {projectsLoading ? <div className={styles.empty}>LOADING PROJECTS...</div> : selectedUserProjects.length === 0 ? <div className={styles.empty}>NO PROJECTS FOUND</div> : visibleProjects.length === 0 ? <div className={styles.emptySearch}>NO PROJECTS MATCH YOUR SEARCH</div> : <div className={styles.projectList}>{visibleProjects.map(project => <div className={styles.projectRow} key={project.id} onClick={() => { localStorage.setItem('queued_project_id', project.id); navigate('/designer'); }}><div className={styles.projectIcon}>⌁</div><div className={styles.projectInfo}><strong>{project.name || 'Untitled project'}</strong><small>{project.type || 'network design'} · {project.rooms || 0} rooms · {project.devices || 0} devices</small></div><span className={`${styles.status} ${styles[project.status || 'draft']}`}>{statusLabel(project.status)}</span><span className={styles.arrow}>→</span></div>)}</div>}
              </>}
            </div>
            <div className={`${styles.panel} ${styles.healthPanel}`}><div className={styles.panelHeader}><div><p className={styles.eyebrow}>NETWORK OVERVIEW</p><h2>System health</h2></div><span className={styles.healthRing}>100%</span></div><div className={styles.healthMessage}><span>✓</span><div><strong>All systems operational</strong><small>Dashboard services are running normally.</small></div></div><div className={styles.healthRows}><div><span>API RESPONSE</span><b>READY</b></div><div><span>PROJECT INDEX</span><b>{statistics.total_projects ?? 0} RECORDS</b></div><div><span>LAST SYNC</span><b>JUST NOW</b></div></div></div>
          </section>
        </>}
      </main>
      {userPendingDelete && (
        <div className={styles.confirmBackdrop} role="dialog" aria-modal="true" aria-labelledby="delete-user-title">
          <div className={styles.confirmModal}>
            <button className={styles.confirmClose} onClick={() => setUserPendingDelete(null)} aria-label="Close">×</button>
            <div className={styles.confirmIcon}>!</div>
            <p className={styles.confirmKicker}>DANGER ZONE / ACCOUNT ACTION</p>
            <h2 id="delete-user-title">Delete user account?</h2>
            <p className={styles.confirmText}>This will permanently delete <strong>{userPendingDelete.name}</strong> and all projects associated with this account.</p>
            <div className={styles.confirmActions}>
              <button className={styles.cancelDelete} onClick={() => setUserPendingDelete(null)}>CANCEL</button>
              <button className={styles.confirmDelete} onClick={handleDeleteUser} disabled={deletingUserId === userPendingDelete.id}>{deletingUserId === userPendingDelete.id ? 'DELETING...' : 'DELETE ACCOUNT'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}