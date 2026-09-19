import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
    { path: '/competitions', name: 'competitions', component: () => import('../views/radar/CompetitionListView.vue') },
    { path: '/competitions/:id', name: 'competition-detail', component: () => import('../views/radar/CompetitionDetailView.vue') },
    { path: '/calendar', name: 'calendar', component: () => import('../views/radar/CalendarView.vue') },
    { path: '/teams', name: 'teams', component: () => import('../views/match/TeamListView.vue') },
    { path: '/teams/new', name: 'team-new', component: () => import('../views/match/TeamNewView.vue'), meta: { auth: true } },
    { path: '/teams/:id', name: 'team-detail', component: () => import('../views/match/TeamDetailView.vue') },
    {
      path: '/me',
      component: () => import('../views/me/MeLayout.vue'),
      meta: { auth: true },
      children: [
        { path: '', redirect: '/me/profile' },
        { path: 'profile', name: 'me-profile', component: () => import('../views/me/ProfileView.vue') },
        { path: 'teams', name: 'me-teams', component: () => import('../views/me/MyTeamsView.vue') },
        { path: 'applications', name: 'me-applications', component: () => import('../views/me/MyApplicationsView.vue') },
        { path: 'favorites', name: 'me-favorites', component: () => import('../views/me/MyFavoritesView.vue') },
      ],
    },
    { path: '/notifications', name: 'notifications', component: () => import('../views/NotificationsView.vue'), meta: { auth: true } },
    { path: '/u/:id', name: 'user-card', component: () => import('../views/UserCardView.vue') },
    {
      path: '/admin',
      component: () => import('../views/admin/AdminLayout.vue'),
      meta: { auth: true, admin: true },
      children: [
        { path: '', redirect: '/admin/competitions' },
        { path: 'competitions', name: 'admin-competitions', component: () => import('../views/admin/AdminCompetitionsView.vue') },
        { path: 'competitions/new', name: 'admin-competition-new', component: () => import('../views/admin/AdminCompetitionEdit.vue') },
        { path: 'competitions/:id/edit', name: 'admin-competition-edit', component: () => import('../views/admin/AdminCompetitionEdit.vue') },
        { path: 'corrections', name: 'admin-corrections', component: () => import('../views/admin/AdminCorrectionsView.vue') },
        { path: 'revisions', name: 'admin-revisions', component: () => import('../views/admin/AdminRevisionsView.vue') },
        { path: 'reports', name: 'admin-reports', component: () => import('../views/admin/AdminReportsView.vue') },
        { path: 'users', name: 'admin-users', component: () => import('../views/admin/AdminUsersView.vue') },
        { path: 'announcements', name: 'admin-announcements', component: () => import('../views/admin/AdminAnnouncementsView.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.bootstrap();
  if (to.meta.auth && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.admin && !auth.isAdmin) {
    return { name: 'home' };
  }
  if (to.name === 'login' && auth.isLoggedIn) {
    return { name: 'home' };
  }
  return true;
});
