import React, { useState, useMemo, useEffect } from 'react';
import { Settings, X, Copy, Trash2, Sparkles, Loader2, Save, FolderOpen, LogIn, LogOut } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { auth, db, signInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, updateDoc, doc, onSnapshot, query, where, serverTimestamp, orderBy, deleteDoc, getDoc, setDoc } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const DEFAULT_STOP_WORDS = 'от в из и не до за из ко на об от пo со да же ли ни но то вне для изо меж над обо ото под при про где еже еще ибо или иль ино как раз тож чем что кто для с а о у к';

export default function App() {
  const [phrases, setPhrases] = useState('');
  const [title, setTitle] = useState('');
  const [h1, setH1] = useState('');
  const [link, setLink] = useState('');
  const [description, setDescription] = useState('');
  const [stopWordsStr, setStopWordsStr] = useState(DEFAULT_STOP_WORDS);
  const [deletedWords, setDeletedWords] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Новый проект');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      return;
    }

    // Load user settings
    const fetchSettings = async () => {
      try {
        const docRef = doc(db, 'userSettings', user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.stopWords) setStopWordsStr(data.stopWords);
          if (data.limits) setLimits(data.limits);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `userSettings/${user.uid}`);
      }
    };
    fetchSettings();

    const q = query(collection(db, 'projects'), where('uid', '==', user.uid), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProjects(projs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    });
    return () => unsubscribe();
  }, [user]);

  const [limits, setLimits] = useState({
    yandexTitle: 60,
    googleTitle: 50,
    yandexDesc: 170,
    googleDesc: 160,
    yandexH1: 60,
    googleH1: 50,
  });

  const stopWords = useMemo(() => new Set(stopWordsStr.split(/\s+/).filter(Boolean)), [stopWordsStr]);

  const analyzedWords = useMemo(() => {
    const words = phrases.toLowerCase().replace(/[^а-яёa-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 0);
    const counts: Record<string, number> = {};
    words.forEach(w => {
      if (!stopWords.has(w) && !deletedWords.has(w)) {
        counts[w] = (counts[w] || 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [phrases, stopWords, deletedWords]);

  const titleLower = title.toLowerCase();
  const descLower = description.toLowerCase();
  const h1Lower = h1.toLowerCase();

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const clearMeta = () => {
    setTitle('');
    setH1('');
    setLink('');
    setDescription('');
    setPhrases('');
    setDeletedWords(new Set());
    setCurrentProjectId(null);
    setProjectName('Новый проект');
  };

  const saveProject = async () => {
    if (!user) {
      alert('Пожалуйста, войдите в систему, чтобы сохранять проекты.');
      return;
    }
    setIsSaving(true);
    try {
      const projectData = {
        uid: user.uid,
        name: projectName,
        phrases,
        title,
        description,
        h1,
        link,
        deletedWords: Array.from(deletedWords),
        updatedAt: serverTimestamp()
      };

      if (currentProjectId) {
        await updateDoc(doc(db, 'projects', currentProjectId), projectData);
        alert('Проект успешно обновлен!');
      } else {
        const docRef = await addDoc(collection(db, 'projects'), {
          ...projectData,
          createdAt: serverTimestamp()
        });
        setCurrentProjectId(docRef.id);
        alert('Проект успешно сохранен!');
      }
    } catch (error) {
      handleFirestoreError(error, currentProjectId ? OperationType.UPDATE : OperationType.CREATE, currentProjectId ? `projects/${currentProjectId}` : 'projects');
      alert('Ошибка при сохранении проекта.');
    } finally {
      setIsSaving(false);
    }
  };

  const loadProject = (project: any) => {
    setCurrentProjectId(project.id);
    setProjectName(project.name || 'Без названия');
    setPhrases(project.phrases || '');
    setTitle(project.title || '');
    setDescription(project.description || '');
    setH1(project.h1 || '');
    setLink(project.link || '');
    setDeletedWords(new Set(project.deletedWords || []));
    setShowProjects(false);
  };

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Вы уверены, что хотите удалить этот проект?')) return;
    try {
      await deleteDoc(doc(db, 'projects', id));
      if (currentProjectId === id) {
        clearMeta();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${id}`);
      alert('Ошибка при удалении проекта.');
    }
  };

  const saveSettings = async () => {
    if (user) {
      try {
        await setDoc(doc(db, 'userSettings', user.uid), {
          uid: user.uid,
          stopWords: stopWordsStr,
          limits,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `userSettings/${user.uid}`);
      }
    }
    setShowSettings(false);
  };

  const generateMetaTags = async () => {
    if (analyzedWords.length === 0) {
      alert('Сначала добавьте ключевые фразы для анализа.');
      return;
    }

    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const topWords = analyzedWords.slice(0, 15).map(w => w[0]).join(', ');

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Сгенерируй SEO мета-теги (Title, Description, H1) на основе следующих ключевых слов, отсортированных по важности (от самых важных к менее важным): ${topWords}. 
        Title должен быть до ${Math.max(limits.yandexTitle, limits.googleTitle)} символов.
        Description должен быть до ${Math.max(limits.yandexDesc, limits.googleDesc)} символов.
        H1 должен быть до ${Math.max(limits.yandexH1, limits.googleH1)} символов.
        Сделай текст привлекательным и кликабельным для людей.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "SEO Title" },
              description: { type: Type.STRING, description: "SEO Description" },
              h1: { type: Type.STRING, description: "SEO H1" }
            },
            required: ["title", "description", "h1"]
          }
        }
      });

      if (response.text) {
        const data = JSON.parse(response.text);
        setTitle(data.title || '');
        setDescription(data.description || '');
        setH1(data.h1 || '');
      }
    } catch (error) {
      console.error('Error generating meta tags:', error);
      alert('Произошла ошибка при генерации мета-тегов.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-sm">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-[#074a7b]">Мета-теги онлайн</h1>
          <div className="h-6 w-px bg-gray-300"></div>
          <input 
            type="text" 
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            className="text-sm font-medium text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-[#074a7b] outline-none px-1 py-0.5 transition-colors"
            placeholder="Название проекта"
          />
        </div>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <button 
                onClick={saveProject}
                disabled={isSaving}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-[#074a7b] hover:bg-[#063a61] px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Сохранить
              </button>
              <button 
                onClick={() => setShowProjects(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-[#074a7b] bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md transition-colors"
              >
                <FolderOpen size={16} />
                Мои проекты
              </button>
              <div className="h-5 w-px bg-gray-300 mx-1"></div>
              <span className="text-sm text-gray-500 truncate max-w-[150px]">{user.email}</span>
              <button 
                onClick={logOut}
                className="text-gray-400 hover:text-red-500 transition-colors"
                title="Выйти"
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <button 
              onClick={signInWithGoogle}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-[#074a7b] bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md transition-colors"
            >
              <LogIn size={16} />
              Войти через Google
            </button>
          )}
          <div className="h-5 w-px bg-gray-300 mx-1"></div>
          <button 
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-[#074a7b] transition-colors"
          >
            <Settings size={18} />
            <span>Настройки</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Col 1: Phrases */}
        <div className="w-1/4 min-w-[250px] border-r border-gray-200 bg-white flex flex-col">
          <div className="p-3 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0">
            <span className="font-medium text-gray-700">Ключевые фразы</span>
            <button onClick={() => setPhrases('')} className="text-gray-400 hover:text-red-500 transition-colors" title="Очистить">
              <Trash2 size={16} />
            </button>
          </div>
          <textarea
            className="flex-1 w-full p-4 resize-none outline-none focus:ring-2 focus:ring-inset focus:ring-[#074a7b]"
            placeholder="Вставьте ключевые запросы..."
            value={phrases}
            onChange={e => setPhrases(e.target.value)}
          />
        </div>

        {/* Col 2: Analysis */}
        <div className="w-1/4 min-w-[250px] border-r border-gray-200 bg-white flex flex-col">
          <div className="p-3 border-b border-gray-200 bg-gray-50 shrink-0 flex justify-between items-center">
            <span className="font-medium text-gray-700">Анализ слов</span>
            {deletedWords.size > 0 && (
              <button 
                onClick={() => setDeletedWords(new Set())}
                className="text-xs text-[#074a7b] hover:underline"
              >
                Сбросить удаленные
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {analyzedWords.length === 0 ? (
              <div className="text-gray-500 text-center mt-10 px-4">
                Здесь появятся слова из левой колонки, отсортированные по количеству повторов.
              </div>
            ) : (
              <div className="space-y-1">
                {analyzedWords.map(([word, count]) => {
                  const inTitle = titleLower.includes(word);
                  const inDesc = descLower.includes(word);
                  const inH1 = h1Lower.includes(word);

                  return (
                    <div key={word} className="flex items-center group hover:bg-gray-50 p-1.5 rounded transition-colors">
                      <div className="flex gap-1 w-16 shrink-0">
                        <span className={`w-4 h-4 text-[10px] flex items-center justify-center rounded font-bold ${inTitle ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>t</span>
                        <span className={`w-4 h-4 text-[10px] flex items-center justify-center rounded font-bold ${inDesc ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>d</span>
                        <span className={`w-4 h-4 text-[10px] flex items-center justify-center rounded font-bold ${inH1 ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>h</span>
                      </div>
                      <div className="w-8 text-right font-mono text-gray-500 mr-3">{count}</div>
                      <div className="flex-1 truncate font-medium text-gray-800" title={word}>{word}</div>
                      <button 
                        onClick={() => {
                          const newDeleted = new Set(deletedWords);
                          newDeleted.add(word);
                          setDeletedWords(newDeleted);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 px-1 transition-opacity"
                        title="Удалить слово"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Col 3: Meta & Snippets */}
        <div className="flex-1 bg-gray-50 flex flex-col overflow-y-auto">
          {/* Snippets */}
          <div className="p-6 space-y-6 shrink-0">
            {/* Yandex Snippet */}
            <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 max-w-[650px]">
              <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider font-semibold">Яндекс</div>
              <div className="text-[#0066cc] text-xl font-medium hover:underline cursor-pointer truncate mb-1">
                {title || 'Здесь будет отображаться ваш Title для Яндекс'}
              </div>
              <div className="text-[#006600] text-sm truncate mb-1.5">
                {link ? `example.com › ${link}` : 'example.com'}
              </div>
              <div className="text-[#333] text-sm line-clamp-2 leading-snug">
                {description || 'Чтобы правильно заполнить мета-тег Description, ориентируйтесь на фрагменты описаний, которые поисковые системы включают в сниппеты ТОП-10 по вашим ключевым запросам.'}
              </div>
            </div>

            {/* Google Snippet */}
            <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 max-w-[650px]">
              <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider font-semibold">Google</div>
              <div className="text-[#202124] text-sm truncate mb-1">
                https://example.com {link ? `› ${link}` : ''}
              </div>
              <div className="text-[#1a0dab] text-xl font-medium hover:underline cursor-pointer truncate mb-1.5">
                {title || 'Здесь будет отображаться ваш Title для Google'}
              </div>
              <div className="text-[#4d5156] text-sm line-clamp-2 leading-snug">
                {description || 'Чтобы правильно заполнить мета-тег Description, ориентируйтесь на фрагменты описаний, которые поисковые системы включают в сниппеты ТОП-10 по вашим ключевым запросам.'}
              </div>
            </div>
          </div>

          {/* Inputs */}
          <div className="p-6 pt-0 flex-1 flex flex-col gap-6">
            <div className="flex gap-6 h-full">
              {/* Left Inputs */}
              <div className="flex-1 space-y-6 flex flex-col">
                {/* Title */}
                <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                  <div className="flex justify-between text-xs text-gray-500 mb-3 font-medium">
                    <span className="uppercase tracking-wider">Title</span>
                    <span>
                      Я: <span className={title.length > limits.yandexTitle ? 'text-red-500 font-bold' : ''}>{title.length}</span>/{limits.yandexTitle} &nbsp;
                      G: <span className={title.length > limits.googleTitle ? 'text-red-500 font-bold' : ''}>{title.length}</span>/{limits.googleTitle}
                    </span>
                  </div>
                  <textarea
                    className="w-full resize-none outline-none text-sm"
                    rows={3}
                    placeholder="Вводите текст Title в это поле"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                  />
                </div>

                {/* H1 */}
                <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                  <div className="flex justify-between text-xs text-gray-500 mb-3 font-medium">
                    <span className="uppercase tracking-wider">H1</span>
                    <span>
                      Я: <span className={h1.length > limits.yandexH1 ? 'text-red-500 font-bold' : ''}>{h1.length}</span>/{limits.yandexH1} &nbsp;
                      G: <span className={h1.length > limits.googleH1 ? 'text-red-500 font-bold' : ''}>{h1.length}</span>/{limits.googleH1}
                    </span>
                  </div>
                  <textarea
                    className="w-full resize-none outline-none text-sm"
                    rows={2}
                    placeholder="H1 – используется для копирования в буфер обмена"
                    value={h1}
                    onChange={e => setH1(e.target.value)}
                  />
                </div>

                {/* Link */}
                <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                  <div className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wider">Link</div>
                  <textarea
                    className="w-full resize-none outline-none text-sm"
                    rows={1}
                    placeholder="Link – используется для визуализации в сниппетах"
                    value={link}
                    onChange={e => setLink(e.target.value)}
                  />
                </div>
              </div>

              {/* Right Inputs */}
              <div className="flex-1 space-y-6 flex flex-col">
                {/* Description */}
                <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm flex-1 flex flex-col">
                  <div className="flex justify-between text-xs text-gray-500 mb-3 font-medium">
                    <span className="uppercase tracking-wider">Description</span>
                    <span>
                      Я: <span className={description.length > limits.yandexDesc ? 'text-red-500 font-bold' : ''}>{description.length}</span>/{limits.yandexDesc} &nbsp;
                      G: <span className={description.length > limits.googleDesc ? 'text-red-500 font-bold' : ''}>{description.length}</span>/{limits.googleDesc}
                    </span>
                  </div>
                  <textarea
                    className="w-full flex-1 resize-none outline-none text-sm"
                    placeholder="Вводите текст Description в это поле..."
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                  />
                </div>
                
                {/* Buttons */}
                <div className="flex gap-3 shrink-0">
                  <button 
                    onClick={generateMetaTags}
                    disabled={isGenerating || analyzedWords.length === 0}
                    className="flex-1 px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white rounded-lg transition-colors flex items-center justify-center gap-2 font-medium shadow-sm"
                  >
                    {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                    {isGenerating ? 'Генерация...' : 'Сгенерировать ИИ'}
                  </button>
                  <button 
                    onClick={() => handleCopy(`${title}\n${description}\n${h1}`)}
                    className="flex-1 px-4 py-3 bg-[#074a7b] hover:bg-[#063a61] text-white rounded-lg transition-colors flex items-center justify-center gap-2 font-medium shadow-sm"
                  >
                    <Copy size={18} />
                    Скопировать
                  </button>
                  <button 
                    onClick={clearMeta}
                    className="px-4 py-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg transition-colors font-medium shadow-sm"
                    title="Очистить"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Projects Modal */}
      {showProjects && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
            <div className="p-5 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">Мои проекты</h2>
              <button 
                onClick={() => setShowProjects(false)} 
                className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {projects.length === 0 ? (
                <div className="text-center text-gray-500 py-10">У вас пока нет сохраненных проектов.</div>
              ) : (
                <div className="space-y-2">
                  {projects.map(p => (
                    <div 
                      key={p.id} 
                      onClick={() => loadProject(p)}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors flex justify-between items-center group ${currentProjectId === p.id ? 'border-[#074a7b] bg-blue-50' : 'border-gray-200 hover:border-[#074a7b]'}`}
                    >
                      <div>
                        <div className="font-medium text-gray-800">{p.name || 'Без названия'}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {p.updatedAt?.toDate ? new Date(p.updatedAt.toDate()).toLocaleString() : 'Только что'}
                        </div>
                      </div>
                      <button 
                        onClick={(e) => deleteProject(p.id, e)}
                        className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-2"
                        title="Удалить проект"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">Настройки</h2>
              <button 
                onClick={() => setShowSettings(false)} 
                className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-8">
              <div>
                <h3 className="font-semibold text-gray-800 mb-4 text-base">Количество символов</h3>
                <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-100 border-b border-gray-200">
                      <tr>
                        <th className="py-3 px-4 font-medium text-gray-600">Google</th>
                        <th className="py-3 px-4 font-medium text-gray-600">Yandex</th>
                        <th className="py-3 px-4 font-medium text-gray-600">Тег</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      <tr>
                        <td className="py-3 px-4"><input type="number" className="border border-gray-300 rounded px-3 py-1.5 w-24 focus:ring-2 focus:ring-[#074a7b] outline-none" value={limits.googleTitle} onChange={e => setLimits({...limits, googleTitle: +e.target.value})} /></td>
                        <td className="py-3 px-4"><input type="number" className="border border-gray-300 rounded px-3 py-1.5 w-24 focus:ring-2 focus:ring-[#074a7b] outline-none" value={limits.yandexTitle} onChange={e => setLimits({...limits, yandexTitle: +e.target.value})} /></td>
                        <td className="py-3 px-4 font-medium text-gray-700">Title</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4"><input type="number" className="border border-gray-300 rounded px-3 py-1.5 w-24 focus:ring-2 focus:ring-[#074a7b] outline-none" value={limits.googleDesc} onChange={e => setLimits({...limits, googleDesc: +e.target.value})} /></td>
                        <td className="py-3 px-4"><input type="number" className="border border-gray-300 rounded px-3 py-1.5 w-24 focus:ring-2 focus:ring-[#074a7b] outline-none" value={limits.yandexDesc} onChange={e => setLimits({...limits, yandexDesc: +e.target.value})} /></td>
                        <td className="py-3 px-4 font-medium text-gray-700">Description</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4"><input type="number" className="border border-gray-300 rounded px-3 py-1.5 w-24 focus:ring-2 focus:ring-[#074a7b] outline-none" value={limits.googleH1} onChange={e => setLimits({...limits, googleH1: +e.target.value})} /></td>
                        <td className="py-3 px-4"><input type="number" className="border border-gray-300 rounded px-3 py-1.5 w-24 focus:ring-2 focus:ring-[#074a7b] outline-none" value={limits.yandexH1} onChange={e => setLimits({...limits, yandexH1: +e.target.value})} /></td>
                        <td className="py-3 px-4 font-medium text-gray-700">H1</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 mb-2 text-base">Служебные части речи</h3>
                <p className="text-gray-500 text-xs mb-4">Эти слова будут исключены из анализа частотности.</p>
                <textarea 
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm h-32 resize-none focus:ring-2 focus:ring-[#074a7b] outline-none"
                  value={stopWordsStr}
                  onChange={e => setStopWordsStr(e.target.value)}
                />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end">
              <button
                onClick={saveSettings}
                className="bg-[#074a7b] hover:bg-[#063a61] text-white px-6 py-2 rounded-lg font-medium transition-colors"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
