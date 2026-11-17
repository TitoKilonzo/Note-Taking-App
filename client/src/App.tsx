import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowRight, BookOpen, Check, ChevronDown, FileText, Folder, Heart, Home, Info, Link2, LogOut, Menu, Pencil, Plus, Search, Settings2, Star, Trash2, X } from 'lucide-react';

type User = { id: string; name: string; email: string };
type Category = { id: string; name: string; color: string };
type TagItem = { id: string; name: string; color: string };
type ApiNote = {
  id: string;
  title: string;
  plainText: string;
  content: unknown;
  isFavorite: boolean;
  isPinned: boolean;
  status: 'ACTIVE' | 'ARCHIVED' | 'TRASHED';
  updatedAt: string;
  category: Category | null;
  tags: { tag: TagItem }[];
};
type Note = {
  id: string;
  title: string;
  body: string;
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  tags: TagItem[];
  date: string;
  favorite: boolean;
  pinned: boolean;
  status: ApiNote['status'];
};
type Page = 'home' | 'about' | 'auth' | 'workspace';
type ApiOptions = RequestInit & { token?: string | null };
type CollectionEditor = { kind: 'category' | 'tag'; id?: string; name: string; color: string };

const API_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';
const categoryPalette = ['#d77b27', '#7297c4', '#8e70ae', '#4f9d79', '#d46969'];
const tagPalette = ['#8b65a8', '#4f9d79', '#d77b27', '#598ab5'];

async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { token, headers, ...requestOptions } = options;
  const response = await fetch(`${API_URL}${path}`, {
    ...requestOptions,
    headers: {
      ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!result.error && response.status >= 500) {
      throw new Error('The Noted API is unavailable. Start both app services with "npm run dev" from the project root.');
    }
    throw new Error(result.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function mapNote(note: ApiNote): Note {
  const content = note.content && typeof note.content === 'object' ? note.content as { body?: unknown } : {};
  return {
    id: note.id,
    title: note.title,
    body: typeof content.body === 'string' ? content.body : note.plainText,
    categoryId: note.category?.id ?? null,
    categoryName: note.category?.name ?? 'Uncategorised',
    categoryColor: note.category?.color ?? '#aaa39a',
    tags: (note.tags ?? []).map(({ tag }) => tag),
    date: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(note.updatedAt)),
    favorite: note.isFavorite,
    pinned: note.isPinned,
    status: note.status,
  };
}

function errorMessage(error: unknown) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return 'Cannot connect to the Noted API. Start both app services with "npm run dev" from the project root, then check /api/health.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('noted-user');
    return saved ? JSON.parse(saved) as User : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem('noted-token'));
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [view, setView] = useState('Notes');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [linkTargetId, setLinkTargetId] = useState('');
  const [collectionEditor, setCollectionEditor] = useState<CollectionEditor | null>(null);
  const [collectionError, setCollectionError] = useState('');

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const active = notes.find(note => note.id === selectedId) ?? null;

  useEffect(() => {
    if (!token || !user) return;
    setPage('workspace');
    setLoading(true);
    const requests = [
      api<{ notes: ApiNote[] }>('/notes?status=ACTIVE', { token }),
      api<{ notes: ApiNote[] }>('/notes?status=ARCHIVED', { token }),
      api<{ notes: ApiNote[] }>('/notes?status=TRASHED', { token }),
      api<{ categories: Category[] }>('/categories', { token }),
      api<{ tags: TagItem[] }>('/tags', { token }),
    ] as const;
    Promise.all(requests).then(([activeNotes, archivedNotes, trashedNotes, categoryResult, tagResult]) => {
      const loadedNotes = [...activeNotes.notes, ...archivedNotes.notes, ...trashedNotes.notes].map(mapNote);
      setNotes(loadedNotes);
      setCategories(categoryResult.categories);
      setTags(tagResult.tags);
      setSelectedId(current => current && loadedNotes.some(note => note.id === current) ? current : loadedNotes[0]?.id ?? null);
      setError('');
    }).catch(reason => {
      setError(`Could not load your workspace: ${errorMessage(reason)}`);
      if (reason instanceof Error && /session|token|authentication/i.test(reason.message)) signOut();
    }).finally(() => setLoading(false));
  // Loading is tied to a new session, not to workspace state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id]);

  useEffect(() => {
    const pendingNotes = notes.filter(note => dirtyIds.has(note.id));
    if (!pendingNotes.length || !token) return;
    const timeout = window.setTimeout(() => {
      for (const note of pendingNotes) {
        const save = async () => {
          await api(`/notes/${note.id}`, {
            method: 'PATCH',
            token,
            body: JSON.stringify({
              title: note.title,
              content: { body: note.body },
              plainText: note.body,
              categoryId: note.categoryId,
              tagIds: note.tags.map(tag => tag.id),
              isFavorite: note.favorite,
              isPinned: note.pinned,
              status: note.status,
            }),
          });
          const current = notesRef.current.find(item => item.id === note.id);
          const unchanged = current &&
            current.title === note.title &&
            current.body === note.body &&
            current.categoryId === note.categoryId &&
            current.favorite === note.favorite &&
            current.pinned === note.pinned &&
            current.status === note.status &&
            current.tags.map(tag => tag.id).join(',') === note.tags.map(tag => tag.id).join(',');
          if (unchanged) {
            setDirtyIds(currentIds => {
              const next = new Set(currentIds);
              next.delete(note.id);
              return next;
            });
          }
        };
        saveQueue.current = saveQueue.current.then(save).catch(reason => {
          setError(`Changes could not be saved: ${errorMessage(reason)}`);
        });
      }
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [notes, dirtyIds, token]);

  function signOut() {
    localStorage.removeItem('noted-token');
    localStorage.removeItem('noted-user');
    setToken(null);
    setUser(null);
    setNotes([]);
    setCategories([]);
    setTags([]);
    setDirtyIds(new Set());
    setPage('home');
    setView('Notes');
    setCategoryFilter(null);
    setTagFilter(null);
    setQuery('');
    setSelectedId(null);
  }

  function markDirty(id: string) {
    setDirtyIds(current => new Set(current).add(id));
  }

  function updateNote(patch: Partial<Note>) {
    if (!active) return;
    setNotes(current => current.map(note => note.id === active.id ? { ...note, ...patch } : note));
    markDirty(active.id);
    setError('');
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      ...(authMode === 'register' ? { name: String(form.get('name') ?? '') } : {}),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };
    try {
      const result = await api<{ token: string; user: User }>(`/auth/${authMode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      localStorage.setItem('noted-token', result.token);
      localStorage.setItem('noted-user', JSON.stringify(result.user));
      setToken(result.token);
      setUser(result.user);
      setPage('workspace');
    } catch (reason) {
      setAuthError(errorMessage(reason));
    } finally {
      setAuthLoading(false);
    }
  }

  async function createNote() {
    if (!token) return;
    try {
      const result = await api<{ note: ApiNote }>('/notes', {
        method: 'POST',
        token,
        body: JSON.stringify({ title: 'Untitled note', content: { body: '' }, plainText: '', categoryId: categories[0]?.id ?? null }),
      });
      const note = mapNote(result.note);
      setNotes(current => [note, ...current]);
      setSelectedId(note.id);
      setView('Notes');
      setCategoryFilter(null);
      setTagFilter(null);
      setMobileListOpen(false);
    } catch (reason) {
      setError(`Could not create note: ${errorMessage(reason)}`);
    }
  }

  function openCollectionEditor(kind: CollectionEditor['kind'], item?: Category | TagItem) {
    const palette = kind === 'category' ? categoryPalette : tagPalette;
    const count = kind === 'category' ? categories.length : tags.length;
    setCollectionError('');
    setCollectionEditor({
      kind,
      id: item?.id,
      name: item?.name ?? '',
      color: item?.color ?? palette[count % palette.length],
    });
  }

  async function saveCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!collectionEditor || !token) return;
    const { kind, id, name, color } = collectionEditor;
    if (!name.trim()) {
      setCollectionError('Please enter a name.');
      return;
    }
    try {
      if (kind === 'category') {
        const path = id ? `/categories/${id}` : '/categories';
        const result = await api<{ category: Category }>(path, {
          method: id ? 'PATCH' : 'POST',
          token,
          body: JSON.stringify({ name: name.trim(), color }),
        });
        setCategories(current => {
          const next = id
            ? current.map(item => item.id === id ? result.category : item)
            : [...current, result.category];
          return next.sort((a, b) => a.name.localeCompare(b.name));
        });
        if (id) {
          setNotes(current => current.map(note => note.categoryId === id
            ? { ...note, categoryName: result.category.name, categoryColor: result.category.color }
            : note));
        }
      } else {
        const path = id ? `/tags/${id}` : '/tags';
        const result = await api<{ tag: TagItem }>(path, {
          method: id ? 'PATCH' : 'POST',
          token,
          body: JSON.stringify({ name: name.trim(), color }),
        });
        setTags(current => {
          const next = id
            ? current.map(item => item.id === id ? result.tag : item)
            : [...current, result.tag];
          return next.sort((a, b) => a.name.localeCompare(b.name));
        });
        if (id) {
          setNotes(current => current.map(note => ({
            ...note,
            tags: note.tags.map(item => item.id === id ? result.tag : item),
          })));
        }
      }
      setCollectionEditor(null);
    } catch (reason) {
      setCollectionError(errorMessage(reason));
    }
  }

  function createCategory() {
    openCollectionEditor('category');
  }

  function renameCategory(category: Category) {
    openCollectionEditor('category', category);
  }

  function createTag() {
    openCollectionEditor('tag');
  }

  function renameTag(tag: TagItem) {
    openCollectionEditor('tag', tag);
  }

  async function deleteCategory(category: Category) {
    if (!token || !window.confirm(`Delete "${category.name}"? Notes in it will be kept without a category.`)) return;
    try {
      await api(`/categories/${category.id}`, { method: 'DELETE', token });
      setCategories(current => current.filter(item => item.id !== category.id));
      setNotes(current => current.map(note => note.categoryId === category.id ? { ...note, categoryId: null, categoryName: 'Uncategorised', categoryColor: '#aaa39a' } : note));
      if (categoryFilter === category.id) setCategoryFilter(null);
    } catch (reason) {
      setError(`Could not delete category: ${errorMessage(reason)}`);
    }
  }

  async function deleteTag(tag: TagItem) {
    if (!token || !window.confirm(`Delete the "${tag.name}" tag?`)) return;
    try {
      await api(`/tags/${tag.id}`, { method: 'DELETE', token });
      setTags(current => current.filter(item => item.id !== tag.id));
      setNotes(current => current.map(note => ({ ...note, tags: note.tags.filter(item => item.id !== tag.id) })));
      if (tagFilter === tag.id) setTagFilter(null);
    } catch (reason) {
      setError(`Could not delete tag: ${errorMessage(reason)}`);
    }
  }

  function moveToTrash(note: Note) {
    setNotes(current => current.map(item => item.id === note.id ? { ...item, status: 'TRASHED' } : item));
    markDirty(note.id);
    if (active?.id === note.id) setSelectedId(null);
  }

  async function permanentlyDelete(note: Note) {
    if (!token || !window.confirm(`Permanently delete "${note.title}"? This cannot be undone.`)) return;
    try {
      await api(`/notes/${note.id}/permanent`, { method: 'DELETE', token });
      setNotes(current => current.filter(item => item.id !== note.id));
      setSelectedId(null);
    } catch (reason) {
      setError(`Could not permanently delete note: ${errorMessage(reason)}`);
    }
  }

  const visibleNotes = useMemo(() => notes.filter(note => {
    if (view === 'Favorites' && !note.favorite) return false;
    if (view === 'Archive' && note.status !== 'ARCHIVED') return false;
    if (view === 'Trash' && note.status !== 'TRASHED') return false;
    if (!['Archive', 'Trash'].includes(view) && note.status !== 'ACTIVE') return false;
    if (categoryFilter && note.categoryId !== categoryFilter) return false;
    if (tagFilter && !note.tags.some(tag => tag.id === tagFilter)) return false;
    return `${note.title} ${note.body} ${note.categoryName} ${note.tags.map(tag => tag.name).join(' ')}`.toLowerCase().includes(query.toLowerCase());
  }), [notes, view, categoryFilter, tagFilter, query]);

  const linkedNotes = useMemo(() => {
    if (!active) return [];
    return notes.filter(note => note.id !== active.id && note.status === 'ACTIVE' && active.body.includes(`[[${note.title}]]`));
  }, [active, notes]);
  const backlinks = useMemo(() => {
    if (!active) return [];
    return notes.filter(note => note.id !== active.id && note.status === 'ACTIVE' && note.body.includes(`[[${active.title}]]`));
  }, [active, notes]);

  function insertPageLink() {
    if (!active) return;
    const target = notes.find(note => note.id === linkTargetId && note.status === 'ACTIVE');
    if (!target) {
      setError('Create another note first to link a page.');
      return;
    }
    updateNote({ body: `${active.body}${active.body && !active.body.endsWith('\n') ? '\n' : ''}[[${target.title}]]` });
    setLinkTargetId('');
  }

  function openWorkspace(viewName = 'Notes') {
    if (token) setPage('workspace');
    else {
      setAuthMode('login');
      setPage('auth');
    }
    setView(viewName);
  }

  if (page === 'home' || page === 'about') {
    return <main className="public-shell">
      <header className="public-nav">
        <button className="public-brand" onClick={() => setPage('home')}><span className="brand-mark"><FileText size={17}/></span>noted<span className="brand-dot">.</span></button>
        <nav><button className={page === 'home' ? 'current' : ''} onClick={() => setPage('home')}><Home size={15}/>Home</button><button className={page === 'about' ? 'current' : ''} onClick={() => setPage('about')}><Info size={15}/>About</button></nav>
        <div className="public-actions">{user ? <button className="button button-outline" onClick={() => openWorkspace()}>Open workspace <ArrowRight size={15}/></button> : <><button className="button button-quiet" onClick={() => { setAuthMode('login'); setPage('auth'); }}>Sign in</button><button className="button button-primary" onClick={() => { setAuthMode('register'); setPage('auth'); }}>Get started <ArrowRight size={15}/></button></>}</div>
      </header>
      {page === 'home' ? <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span/> A little more clarity, every day</div><h1>Your thoughts,<br/><em>beautifully</em> in order.</h1><p>A calm space for notes, plans, and the ideas you don't want to lose. Keep everything connected and close at hand.</p><div className="hero-cta"><button className="button button-primary button-large" onClick={() => { setAuthMode(user ? 'login' : 'register'); setPage(user ? 'workspace' : 'auth'); }}>Start writing <ArrowRight size={17}/></button><button className="text-link" onClick={() => setPage('about')}>Take a look around <ArrowRight size={15}/></button></div><div className="hero-proof"><div className="proof-avatars"><span>S</span><span>M</span><span>A</span></div><span>A thoughtful home for all your ideas</span></div></div>
        <div className="hero-art" aria-label="Preview of the Noted notes workspace"><div className="art-glow"/><div className="preview-window"><div className="preview-sidebar"><div className="preview-logo"><i/><b>noted</b></div><span className="preview-current"><FileText size={13}/> All notes</span><span><Star size={13}/> Favorites</span><span><Archive size={13}/> Archive</span><small>YOUR CATEGORIES</small><span><i className="dot orange"/> Personal</span><span><i className="dot green"/> Work</span><span><i className="dot blue"/> Reading</span><div className="preview-person"><b>ST</b><span>Sam Taylor<small>My workspace</small></span></div></div><div className="preview-list"><div className="preview-listhead"><span>All notes</span><b>+</b></div><div className="preview-search"><Search size={12}/> Search your notes</div><div className="preview-card selected"><b>A slower kind of morning</b><span>Today · Personal</span><p>A few small things that make the day feel like my own...</p></div><div className="preview-card"><b>Ideas for the garden</b><span>Yesterday · Work</span><p>Herbs by the kitchen window. A little more green...</p></div><div className="preview-card"><b>Books to come back to</b><span>Oct 12 · Reading</span><p>Stories, essays, and other places to wander.</p></div></div><div className="preview-editor"><div className="preview-toolbar"><span>Saved just now</span><span>☆　···</span></div><div className="preview-note"><span className="note-kicker">PERSONAL · OCTOBER 16</span><h3>A slower kind<br/>of morning</h3><p>Before the day gets loud, I want to remember that a little space can change everything.</p><p>Make coffee. Open the window.<br/>Write down what matters most.</p><div className="preview-link"><Link2 size={12}/> A note to come back to</div></div></div></div><div className="floating-note"><BookOpen size={16}/><span><b>Little things, together</b><small>Your ideas can find each other.</small></span></div><div className="art-sparkle sparkle-one">✳</div><div className="art-sparkle sparkle-two">✦</div></div>
        <div className="hero-bottom"><span>MAKE SPACE FOR WHAT MATTERS</span><span>Notes that stay connected <Link2 size={14}/></span><span>Yours, and only yours <Heart size={14}/></span></div>
      </section> : <section className="about-page"><div className="eyebrow"><span/> A home for your thoughts</div><h1>Simple by nature.<br/><em>Connected by you.</em></h1><p>Noted is a quiet, personal workspace for everything worth remembering, from everyday lists to the ideas that become something more.</p><div className="about-cards"><article><FileText/><h3>Write without friction</h3><p>Open a note, get it out of your head, and let your thoughts take shape.</p></article><article><Link2/><h3>Let ideas connect</h3><p>Link one note to another and build a web of context that is yours to explore.</p></article><article><Folder/><h3>Make it your own</h3><p>Keep notes close with the categories and tags that make sense to you.</p></article></div><button className="button button-primary" onClick={() => { setAuthMode('register'); setPage('auth'); }}>Make a little room <ArrowRight size={15}/></button></section>}
      <footer className="public-footer"><span>noted<span className="brand-dot">.</span></span><span>A little room for everything on your mind.</span><button onClick={() => setPage(page === 'home' ? 'about' : 'home')}>{page === 'home' ? 'About Noted' : 'Home'} <ArrowRight size={13}/></button></footer>
    </main>;
  }

  if (page === 'auth') {
    return <main className="auth-shell"><button className="auth-back" onClick={() => setPage('home')}>← Back to home</button><div className="auth-card"><button className="public-brand" onClick={() => setPage('home')}><span className="brand-mark"><FileText size={17}/></span>noted<span className="brand-dot">.</span></button><div className="auth-heading"><div className="eyebrow"><span/>{authMode === 'register' ? 'A fresh page awaits' : 'Welcome back'}</div><h1>{authMode === 'register' ? 'Make room for your thoughts.' : 'Good to see you again.'}</h1><p>{authMode === 'register' ? 'Create your account and start gathering your ideas.' : 'Sign in to pick up right where you left off.'}</p></div><form onSubmit={submitAuth} className="auth-form">{authMode === 'register' && <label>Your name<input name="name" autoComplete="name" minLength={2} maxLength={80} required placeholder="Sam Taylor"/></label>}<label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com"/></label><label>Password<input name="password" type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength={authMode === 'register' ? 10 : 1} required placeholder={authMode === 'register' ? 'At least 10 characters' : 'Your password'}/></label>{authError && <p className="form-error" role="alert">{authError}</p>}<button className="button button-primary auth-submit" type="submit" disabled={authLoading}>{authLoading ? 'Connecting…' : authMode === 'register' ? 'Create account' : 'Sign in'} {!authLoading && <ArrowRight size={16}/>}</button></form><p className="auth-switch">{authMode === 'register' ? 'Already have an account?' : 'New to Noted?'} <button onClick={() => { setAuthError(''); setAuthMode(authMode === 'register' ? 'login' : 'register'); }}>{authMode === 'register' ? 'Sign in' : 'Create an account'}</button></p><p className="auth-privacy"><Heart size={13}/> Your notes are private to your account.</p></div></main>;
  }

  const isDirty = active ? dirtyIds.has(active.id) : false;
  return <main className="workspace-shell">
    <header className="workspace-topbar"><button className="workspace-brand" onClick={() => setPage('home')}><span className="brand-mark"><FileText size={16}/></span>noted<span className="brand-dot">.</span></button><div className="workspace-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search all your notes"/><kbd>⌘ K</kbd></div><div className="topbar-user"><span>{user?.name.slice(0, 1).toUpperCase()}</span><strong>{user?.name}</strong><button title="Sign out" onClick={signOut}><LogOut size={15}/></button></div><button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button></header>
    <div className="workspace-layout">
      <aside className={`workspace-sidebar ${menuOpen ? 'menu-open' : ''}`}><div className="sidebar-nav"><small className="sidebar-caption">YOUR SPACE</small>{[{ name: 'Notes', icon: FileText }, { name: 'Favorites', icon: Star }, { name: 'Archive', icon: Archive }, { name: 'Trash', icon: Trash2 }].map(item => <button key={item.name} className={`side-nav-item ${view === item.name && !categoryFilter && !tagFilter ? 'active' : ''}`} onClick={() => { setView(item.name); setCategoryFilter(null); setTagFilter(null); setMenuOpen(false); }}><item.icon size={16}/>{item.name}<span>{item.name === 'Notes' ? notes.filter(note => note.status === 'ACTIVE').length : item.name === 'Favorites' ? notes.filter(note => note.status === 'ACTIVE' && note.favorite).length : item.name === 'Archive' ? notes.filter(note => note.status === 'ARCHIVED').length : notes.filter(note => note.status === 'TRASHED').length}</span></button>)}</div><div className="side-section"><div className="side-section-title"><small>Categories</small><button onClick={createCategory} title="Add category"><Plus size={15}/></button></div>{categories.map(category => <div key={category.id} className="side-label-row"><button className={`side-label ${categoryFilter === category.id ? 'chosen' : ''}`} onClick={() => { setCategoryFilter(categoryFilter === category.id ? null : category.id); setTagFilter(null); setView('Notes'); }}><i style={{ background: category.color }}/>{category.name}</button><div className="label-actions"><button title={`Rename ${category.name}`} onClick={() => renameCategory(category)}><Settings2 size={12}/></button><button title={`Delete ${category.name}`} onClick={() => deleteCategory(category)}><X size={12}/></button></div></div>)}{categories.length === 0 && <span className="sidebar-empty">No categories yet</span>}</div><div className="side-section tags-section"><div className="side-section-title"><small>Tags</small><button onClick={createTag} title="Add tag"><Plus size={15}/></button></div>{tags.map(tag => <div key={tag.id} className="side-label-row"><button className={`side-label ${tagFilter === tag.id ? 'chosen' : ''}`} onClick={() => { setTagFilter(tagFilter === tag.id ? null : tag.id); setCategoryFilter(null); setView('Notes'); }}><i style={{ background: tag.color }}/>{tag.name}</button><div className="label-actions"><button title={`Rename ${tag.name}`} onClick={() => renameTag(tag)}><Settings2 size={12}/></button><button title={`Delete ${tag.name}`} onClick={() => deleteTag(tag)}><X size={12}/></button></div></div>)}{tags.length === 0 && <span className="sidebar-empty">Add tags to group ideas</span>}</div><div className="sidebar-bottom"><button className="side-about" onClick={() => setPage('about')}><Info size={15}/>About Noted</button><div className="sidebar-profile"><span>{user?.name.slice(0, 1).toUpperCase()}</span><div><b>{user?.name}</b><small>{user?.email}</small></div><button title="Sign out" onClick={signOut}><LogOut size={14}/></button></div></div></aside>
      <section className={`notes-panel ${mobileListOpen ? 'mobile-show' : ''}`}>
        <div className="notes-heading">
          <div><div className="eyebrow"><span/> YOUR LIBRARY</div><h1>{tagFilter ? `# ${tags.find(tag => tag.id === tagFilter)?.name}` : categoryFilter ? categories.find(category => category.id === categoryFilter)?.name : view}</h1></div>
          <button className="new-note-button" onClick={createNote}><Plus size={15}/> New note</button>
        </div>
        <div className="notes-count"><span>{visibleNotes.length} {visibleNotes.length === 1 ? 'note' : 'notes'}</span><button onClick={() => setQuery('')}><ChevronDown size={13}/> Recent</button></div>
        <div className="note-list">
          {loading ? <div className="empty-panel">Gathering your notes…</div> : visibleNotes.map(note => <article key={note.id} className={`note-card ${selectedId === note.id ? 'selected' : ''}`}>
            <button className="note-card-main" onClick={() => { setSelectedId(note.id); setMobileListOpen(false); }}>
              <div className="note-card-heading"><strong>{note.title || 'Untitled note'}</strong><time>{note.date}</time></div>
              <p>{note.body.trim().replace(/\s+/g, ' ').slice(0, 105) || 'A fresh page, ready when you are.'}</p>
              <div className="note-card-meta"><span><i style={{ background: note.categoryColor }}/>{note.categoryName}</span><span className="card-icons">{note.pinned && <span className="pin-mark">PIN</span>}{note.favorite && <Star size={13} fill="currentColor"/>}{note.tags.slice(0, 2).map(tag => <small key={tag.id}>#{tag.name}</small>)}</span></div>
            </button>
            <div className="note-card-actions">
              <button onClick={() => { setSelectedId(note.id); setMobileListOpen(false); }} aria-label={`Edit ${note.title || 'untitled note'}`}><Pencil size={13}/> Edit</button>
              {note.status !== 'TRASHED' && <button className="note-delete-action" onClick={() => moveToTrash(note)} aria-label={`Delete ${note.title || 'untitled note'}`}><Trash2 size={13}/> Delete</button>}
            </div>
          </article>)}
          {!loading && !visibleNotes.length && <div className="empty-panel"><div className="empty-icon"><FileText size={20}/></div><b>{query ? 'No notes found' : 'A little room to begin'}</b><p>{query ? 'Try another search or clear the current filters.' : 'Your next thought has a place to land.'}</p>{!query && view !== 'Trash' && <button className="text-link" onClick={createNote}>Write your first note <ArrowRight size={14}/></button>}</div>}
        </div>
        <div className="list-footnote"><span><span/> Everything in its place</span><span>PRIVATE SPACE</span></div>
      </section>
      <section className={`note-editor ${mobileListOpen ? 'mobile-hide' : ''}`}>{active ? <>      <div className="editor-header"><button className="mobile-back" onClick={() => setMobileListOpen(true)}>← Notes</button><span className={`save-indicator ${error ? 'has-error' : ''}`}><i/>{error ? 'Needs attention' : isDirty ? 'Saving…' : 'All changes saved'}</span><div className="editor-header-actions"><button title="Favorite note" className={active.favorite ? 'icon-active' : ''} onClick={() => updateNote({ favorite: !active.favorite })}><Star size={17} fill={active.favorite ? 'currentColor' : 'none'}/></button><button title={active.pinned ? 'Unpin note' : 'Pin note'} className={active.pinned ? 'icon-active' : ''} onClick={() => updateNote({ pinned: !active.pinned })}>PIN</button></div></div><div className="editor-toolbar"><select aria-label="Note category" value={active.categoryId ?? ''} onChange={event => { const selectedCategory = categories.find(item => item.id === event.target.value); updateNote({ categoryId: selectedCategory?.id ?? null, categoryName: selectedCategory?.name ?? 'Uncategorised', categoryColor: selectedCategory?.color ?? '#aaa39a' }); }}><option value="">Uncategorised</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select><span className="toolbar-divider"/><div className="link-control"><Link2 size={14}/><select aria-label="Choose a note to link" value={linkTargetId} onChange={event => setLinkTargetId(event.target.value)}><option value="">Link a page…</option>{notes.filter(note => note.id !== active.id && note.status === 'ACTIVE').map(note => <option key={note.id} value={note.id}>{note.title || 'Untitled note'}</option>)}</select><button disabled={!linkTargetId} onClick={insertPageLink}>Add</button></div><div className="editor-tags">{tags.map(tag => <button key={tag.id} className={active.tags.some(item => item.id === tag.id) ? 'tag-chip selected' : 'tag-chip'} onClick={() => updateNote({ tags: active.tags.some(item => item.id === tag.id) ? active.tags.filter(item => item.id !== tag.id) : [...active.tags, tag] })}>#{tag.name}</button>)}</div></div><div className="editor-scroll"><div className="editor-content"><div className="note-date">{active.categoryName.toUpperCase()} <span>·</span> LAST EDITED {active.date.toUpperCase()}</div><input className="note-title-input" aria-label="Note title" value={active.title} maxLength={200} onChange={event => updateNote({ title: event.target.value })} placeholder="Untitled note"/><textarea className="note-body-input" aria-label="Note content" value={active.body} maxLength={100000} onChange={event => updateNote({ body: event.target.value })} placeholder="Start wherever you are…"/>{(linkedNotes.length > 0 || backlinks.length > 0) && <section className="linked-pages"><h3><Link2 size={14}/> Connected pages</h3>{[...linkedNotes.map(note => ({ note, label: 'Links to' })), ...backlinks.map(note => ({ note, label: 'Linked from' }))].map(({ note, label }) => <button key={`${label}-${note.id}`} onClick={() => setSelectedId(note.id)}><span>{label}</span>{note.title || 'Untitled note'}<ArrowRight size={13}/></button>)}</section>}</div></div><footer className="editor-footer"><span>{active.body.trim() ? active.body.trim().split(/\s+/).length : 0} words</span><span>·</span><span>Private to you</span><div className="footer-actions">{active.status === 'TRASHED' ? <><button onClick={() => updateNote({ status: 'ACTIVE' })}><Check size={14}/> Restore</button><button className="danger-action" onClick={() => permanentlyDelete(active)}><Trash2 size={14}/> Delete forever</button></> : active.status === 'ARCHIVED' ? <><button onClick={() => updateNote({ status: 'ACTIVE' })}><Check size={14}/> Restore</button><button onClick={() => moveToTrash(active)}><Trash2 size={14}/> Move to trash</button></> : <><button onClick={() => updateNote({ status: 'ARCHIVED' })}><Archive size={14}/> Archive</button><button onClick={() => moveToTrash(active)}><Trash2 size={14}/> Move to trash</button></>}</div></footer></> : <div className="editor-empty"><div className="empty-icon"><FileText size={23}/></div><h2>Make room for a thought.</h2><p>Select a note or start with a new one.</p><button className="button button-primary" onClick={createNote}><Plus size={15}/> New note</button></div>}</section>
    </div>
    {collectionEditor && <div className="collection-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setCollectionEditor(null); }}>
      <section className="collection-modal" role="dialog" aria-modal="true" aria-labelledby="collection-modal-title">
        <div className="collection-modal-heading"><div><span className="eyebrow"><span/> ORGANIZE YOUR SPACE</span><h2 id="collection-modal-title">{collectionEditor.id ? 'Edit' : 'Create'} {collectionEditor.kind}</h2></div><button type="button" onClick={() => setCollectionEditor(null)} aria-label="Close"><X size={17}/></button></div>
        <form onSubmit={saveCollection}>
          <label htmlFor="collection-name">{collectionEditor.kind === 'category' ? 'Category name' : 'Tag name'}</label>
          <input id="collection-name" autoFocus list="collection-suggestions" value={collectionEditor.name} maxLength={40} required onChange={event => setCollectionEditor({ ...collectionEditor, name: event.target.value })} placeholder={collectionEditor.kind === 'category' ? 'For example, Personal' : 'For example, ideas'}/>
          <datalist id="collection-suggestions">{(collectionEditor.kind === 'category' ? categories : tags).filter(item => item.id !== collectionEditor.id).map(item => <option key={item.id} value={item.name}/>)}</datalist>
          <span className="collection-color-label">Choose a color</span>
          <div className="collection-colors">{(collectionEditor.kind === 'category' ? categoryPalette : tagPalette).map(color => <button key={color} type="button" className={collectionEditor.color === color ? 'chosen' : ''} style={{ background: color }} onClick={() => setCollectionEditor({ ...collectionEditor, color })} aria-label={`Choose ${color}`} aria-pressed={collectionEditor.color === color}/>)}</div>
          {collectionError && <p className="form-error" role="alert">{collectionError}</p>}
          <div className="collection-modal-actions"><button type="button" className="button button-quiet" onClick={() => setCollectionEditor(null)}>Cancel</button><button type="submit" className="button button-primary">{collectionEditor.id ? 'Save changes' : `Create ${collectionEditor.kind}`}</button></div>
        </form>
      </section>
    </div>}
    {error && <div className="workspace-alert" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={15}/></button></div>}
  </main>;
}
