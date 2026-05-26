import React, { useState, useMemo } from 'react';
import {
  LayoutDashboard, ListTodo, CalendarDays, TrendingUp, Users,
  CheckCircle2, XCircle, Clock, Plus, Search, ChevronDown,
  Headphones, Settings2, Banknote, ArrowUpRight, Filter,
  Star, Award, Target, AlertCircle, MoreHorizontal, X, Check,
  UserCircle2, LogOut, Sparkles
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, RadialBarChart, RadialBar, PolarAngleAxis,
  AreaChart, Area
} from 'recharts';

// ─────────────────────────────────────────────────────────────
// FONTS  (loaded via <style> tag inside component)
// ─────────────────────────────────────────────────────────────
const FontStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Reem+Kufi:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&family=Frank+Ruhl+Libre:wght@500;700;800&display=swap');

    .font-display { font-family: 'Reem Kufi', serif; letter-spacing: -0.01em; }
    .font-body { font-family: 'IBM Plex Sans Arabic', sans-serif; }
    .font-latin-serif { font-family: 'Frank Ruhl Libre', serif; }

    *::-webkit-scrollbar { width: 6px; height: 6px; }
    *::-webkit-scrollbar-track { background: transparent; }
    *::-webkit-scrollbar-thumb { background: #d4cfc0; border-radius: 999px; }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .anim-slide { animation: slideIn 0.4s ease-out backwards; }

    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }

    .grain::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E");
      pointer-events: none;
      mix-blend-mode: multiply;
    }
  `}</style>
);

// ─────────────────────────────────────────────────────────────
// MOCK DATA
// ─────────────────────────────────────────────────────────────
const TEAMS = {
  cs:    { id: 'cs',    name: 'خدمة العملاء', color: '#2d5d6e', soft: '#dfe9ec', icon: Headphones },
  ops:   { id: 'ops',   name: 'الأوبريشن',     color: '#a86b2c', soft: '#f0e3d2', icon: Settings2 },
  sales: { id: 'sales', name: 'المبيعات',      color: '#8b3a4e', soft: '#ecd9de', icon: Banknote },
};

const EMPLOYEES = [
  { id: 1, name: 'محمد أحمد',     team: 'cs',    role: 'أخصائي خدمة عملاء', avatar: 'م.أ', score: 92, joined: '2023' },
  { id: 2, name: 'سارة إبراهيم',  team: 'cs',    role: 'مشرفة دعم',         avatar: 'س.إ', score: 88, joined: '2022' },
  { id: 3, name: 'عمر خالد',      team: 'ops',   role: 'منسق عمليات',       avatar: 'ع.خ', score: 76, joined: '2024' },
  { id: 4, name: 'ليلى حسن',      team: 'ops',   role: 'أخصائي جودة',       avatar: 'ل.ح', score: 95, joined: '2021' },
  { id: 5, name: 'يوسف منصور',    team: 'sales', role: 'مندوب مبيعات',      avatar: 'ي.م', score: 81, joined: '2023' },
  { id: 6, name: 'هدى ناصر',      team: 'sales', role: 'كبير المبيعات',     avatar: 'ه.ن', score: 89, joined: '2020' },
];

const INITIAL_TASKS = [
  { id: 1, title: 'مراجعة شكاوى العملاء لشهر مايو',         assignee: 1, team: 'cs',    priority: 'عالية',  status: 'قيد التنفيذ', due: '٢٨ مايو' },
  { id: 2, title: 'إعداد تقرير رضا العملاء الأسبوعي',       assignee: 2, team: 'cs',    priority: 'متوسطة', status: 'قيد التنفيذ', due: '٣٠ مايو' },
  { id: 3, title: 'تحديث دليل إجراءات التشغيل',             assignee: 3, team: 'ops',   priority: 'منخفضة', status: 'لم تبدأ',     due: '٥ يونيو' },
  { id: 4, title: 'فحص جودة الشحنات الواردة',               assignee: 4, team: 'ops',   priority: 'عالية',  status: 'مكتملة',      due: '٢٥ مايو' },
  { id: 5, title: 'متابعة عملاء الشهر الحاليين',           assignee: 5, team: 'sales', priority: 'عالية',  status: 'قيد التنفيذ', due: '٢٩ مايو' },
  { id: 6, title: 'إعداد عرض تقديمي للعميل الجديد',        assignee: 6, team: 'sales', priority: 'متوسطة', status: 'قيد التنفيذ', due: '٢ يونيو' },
  { id: 7, title: 'الرد على تذاكر الدعم المتأخرة',          assignee: 1, team: 'cs',    priority: 'عالية',  status: 'لم تبدأ',     due: '٢٧ مايو' },
  { id: 8, title: 'تحليل أداء فريق المبيعات',              assignee: 6, team: 'sales', priority: 'متوسطة', status: 'مكتملة',      due: '٢٤ مايو' },
];

const INITIAL_LEAVES = [
  { id: 1, employee: 1, type: 'إجازة اعتيادية',  from: '٣ يونيو',  to: '٥ يونيو',  days: 3, status: 'معلقة',   reason: 'مناسبة عائلية' },
  { id: 2, employee: 3, type: 'إجازة مرضية',     from: '٢٦ مايو',  to: '٢٦ مايو',  days: 1, status: 'مقبولة',  reason: 'موعد طبي' },
  { id: 3, employee: 5, type: 'إجازة اعتيادية',  from: '١٠ يونيو', to: '١٤ يونيو', days: 5, status: 'معلقة',   reason: 'سفر' },
  { id: 4, employee: 2, type: 'إجازة طارئة',     from: '٢٢ مايو',  to: '٢٢ مايو',  days: 1, status: 'مرفوضة',  reason: 'ظرف شخصي' },
  { id: 5, employee: 4, type: 'إجازة اعتيادية',  from: '١ يوليو',  to: '٧ يوليو',  days: 7, status: 'معلقة',   reason: 'إجازة سنوية' },
];

// Mock weekly performance data for the logged-in employee
const PERF_WEEKLY = [
  { d: 'سبت',    val: 78 },
  { d: 'أحد',    val: 82 },
  { d: 'إثنين',  val: 85 },
  { d: 'ثلاثاء', val: 80 },
  { d: 'أربعاء', val: 91 },
  { d: 'خميس',   val: 88 },
];

const TASK_TREND = [
  { m: 'يناير',   completed: 12, assigned: 18 },
  { m: 'فبراير',  completed: 16, assigned: 20 },
  { m: 'مارس',    completed: 19, assigned: 22 },
  { m: 'أبريل',   completed: 21, assigned: 24 },
  { m: 'مايو',    completed: 24, assigned: 28 },
];

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
const STATUS_STYLES = {
  'قيد التنفيذ': { bg: '#f0e3d2', text: '#7a4d1d', dot: '#a86b2c' },
  'مكتملة':      { bg: '#dce8df', text: '#2a5236', dot: '#3d7a4f' },
  'لم تبدأ':     { bg: '#e8e3d8', text: '#5c5141', dot: '#857961' },
  'معلقة':       { bg: '#f0e3d2', text: '#7a4d1d', dot: '#a86b2c' },
  'مقبولة':      { bg: '#dce8df', text: '#2a5236', dot: '#3d7a4f' },
  'مرفوضة':      { bg: '#ecd9de', text: '#7a2d3e', dot: '#8b3a4e' },
};

const PRIORITY_STYLES = {
  'عالية':  '#8b3a4e',
  'متوسطة': '#a86b2c',
  'منخفضة': '#857961',
};

// ─────────────────────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────
const Pill = ({ children, status, bg, color }) => {
  const s = status ? STATUS_STYLES[status] : null;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ background: bg || s?.bg, color: color || s?.text }}
    >
      {s && <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />}
      {children}
    </span>
  );
};

const Avatar = ({ emp, size = 36 }) => {
  const team = TEAMS[emp.team];
  return (
    <div
      className="flex items-center justify-center rounded-full font-display font-semibold shrink-0"
      style={{
        width: size, height: size,
        background: team.soft, color: team.color,
        fontSize: size * 0.36
      }}
    >
      {emp.avatar}
    </div>
  );
};

const Card = ({ children, className = '', style }) => (
  <div
    className={`bg-[#fbf8f0] border border-[#e8e1cf] rounded-2xl ${className}`}
    style={style}
  >
    {children}
  </div>
);

const SectionHeader = ({ eyebrow, title, action }) => (
  <div className="flex items-end justify-between mb-6">
    <div>
      <div className="text-xs uppercase tracking-[0.2em] text-[#857961] mb-2 font-latin-serif">
        {eyebrow}
      </div>
      <h2 className="font-display text-3xl text-[#1a1d2e] font-medium">{title}</h2>
    </div>
    {action}
  </div>
);

// ─────────────────────────────────────────────────────────────
// MODERATOR VIEWS
// ─────────────────────────────────────────────────────────────
const ModeratorOverview = ({ tasks, leaves }) => {
  const pendingLeaves = leaves.filter(l => l.status === 'معلقة').length;
  const inProgress = tasks.filter(t => t.status === 'قيد التنفيذ').length;
  const completed = tasks.filter(t => t.status === 'مكتملة').length;
  const completionRate = Math.round((completed / tasks.length) * 100);

  const teamStats = Object.values(TEAMS).map(team => {
    const teamTasks = tasks.filter(t => t.team === team.id);
    const done = teamTasks.filter(t => t.status === 'مكتملة').length;
    return {
      ...team,
      total: teamTasks.length,
      done,
      rate: teamTasks.length ? Math.round((done / teamTasks.length) * 100) : 0,
      members: EMPLOYEES.filter(e => e.team === team.id).length
    };
  });

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="OVERVIEW · لوحة المتابعة"
        title="نظرة عامة على الأداء"
        action={
          <div className="text-sm text-[#857961] font-body">
            {new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'إجمالي المهام',    value: tasks.length,    sub: `${inProgress} قيد التنفيذ`, color: '#1a1d2e' },
          { label: 'نسبة الإنجاز',    value: `${completionRate}%`, sub: `${completed} مكتملة`,    color: '#3d7a4f' },
          { label: 'طلبات إجازة معلقة', value: pendingLeaves,   sub: 'تحتاج مراجعة',                color: '#a86b2c' },
          { label: 'إجمالي الموظفين',  value: EMPLOYEES.length, sub: '٣ فرق',                       color: '#8b3a4e' },
        ].map((kpi, i) => (
          <Card key={i} className="p-5 anim-slide" style={{ animationDelay: `${i * 80}ms` }}>
            <div className="text-xs text-[#857961] mb-3 font-body">{kpi.label}</div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-semibold" style={{ color: kpi.color }}>
                {kpi.value}
              </span>
            </div>
            <div className="text-xs text-[#857961] mt-2 font-body">{kpi.sub}</div>
          </Card>
        ))}
      </div>

      {/* Two-column: team breakdown + chart */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-6 col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-[#857961] font-latin-serif mb-1">
                MONTHLY TREND
              </div>
              <div className="font-display text-lg text-[#1a1d2e]">المهام المُسندة مقابل المُنجزة</div>
            </div>
            <Pill bg="#dce8df" color="#2a5236">آخر 5 شهور</Pill>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={TASK_TREND} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#a86b2c" stopOpacity={0.35}/>
                  <stop offset="100%" stopColor="#a86b2c" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#3d7a4f" stopOpacity={0.35}/>
                  <stop offset="100%" stopColor="#3d7a4f" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#e8e1cf" vertical={false}/>
              <XAxis dataKey="m" stroke="#857961" fontSize={11} tickLine={false} axisLine={false} reversed/>
              <YAxis stroke="#857961" fontSize={11} tickLine={false} axisLine={false} orientation="right"/>
              <Tooltip
                contentStyle={{
                  background: '#fbf8f0', border: '1px solid #e8e1cf',
                  borderRadius: 12, fontFamily: 'IBM Plex Sans Arabic'
                }}
              />
              <Area type="monotone" dataKey="assigned"  stroke="#a86b2c" strokeWidth={2} fill="url(#ga)" name="مُسندة"/>
              <Area type="monotone" dataKey="completed" stroke="#3d7a4f" strokeWidth={2} fill="url(#gc)" name="مُنجزة"/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <div className="text-xs uppercase tracking-[0.2em] text-[#857961] font-latin-serif mb-1">TEAMS</div>
          <div className="font-display text-lg text-[#1a1d2e] mb-5">أداء الفرق</div>
          <div className="space-y-5">
            {teamStats.map(t => {
              const Icon = t.icon;
              return (
                <div key={t.id}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ background: t.soft, color: t.color }}
                      >
                        <Icon size={14}/>
                      </div>
                      <span className="font-body text-sm text-[#1a1d2e]">{t.name}</span>
                    </div>
                    <span className="font-display text-sm font-semibold" style={{ color: t.color }}>
                      {t.rate}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#e8e1cf] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${t.rate}%`, background: t.color }}
                    />
                  </div>
                  <div className="text-xs text-[#857961] mt-1.5 font-body">
                    {t.members} أعضاء · {t.done}/{t.total} مهمة
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
};

// ─── Tasks management (moderator) ─────────────────────────────
const ModeratorTasks = ({ tasks, setTasks }) => {
  const [filterTeam, setFilterTeam] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', assignee: 1, priority: 'متوسطة', due: '' });

  const filtered = filterTeam === 'all' ? tasks : tasks.filter(t => t.team === filterTeam);

  const addTask = () => {
    if (!newTask.title.trim()) return;
    const emp = EMPLOYEES.find(e => e.id === Number(newTask.assignee));
    setTasks([
      ...tasks,
      {
        id: Date.now(),
        title: newTask.title,
        assignee: Number(newTask.assignee),
        team: emp.team,
        priority: newTask.priority,
        status: 'لم تبدأ',
        due: newTask.due || 'لاحقاً',
      }
    ]);
    setNewTask({ title: '', assignee: 1, priority: 'متوسطة', due: '' });
    setShowNew(false);
  };

  const cycleStatus = (id) => {
    const order = ['لم تبدأ', 'قيد التنفيذ', 'مكتملة'];
    setTasks(tasks.map(t =>
      t.id === id
        ? { ...t, status: order[(order.indexOf(t.status) + 1) % order.length] }
        : t
    ));
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="TASKS · إدارة المهام"
        title="تقسيم ومتابعة المهام"
        action={
          <button
            onClick={() => setShowNew(!showNew)}
            className="flex items-center gap-2 bg-[#1a1d2e] text-[#fbf8f0] px-4 py-2.5 rounded-xl text-sm font-body hover:bg-[#2a2d3e] transition"
          >
            <Plus size={16}/>
            مهمة جديدة
          </button>
        }
      />

      {showNew && (
        <Card className="p-5 anim-slide">
          <div className="grid grid-cols-12 gap-3">
            <input
              placeholder="عنوان المهمة..."
              value={newTask.title}
              onChange={e => setNewTask({...newTask, title: e.target.value})}
              className="col-span-4 px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
            />
            <select
              value={newTask.assignee}
              onChange={e => setNewTask({...newTask, assignee: e.target.value})}
              className="col-span-3 px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
            >
              {EMPLOYEES.map(e => (
                <option key={e.id} value={e.id}>{e.name} · {TEAMS[e.team].name}</option>
              ))}
            </select>
            <select
              value={newTask.priority}
              onChange={e => setNewTask({...newTask, priority: e.target.value})}
              className="col-span-2 px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
            >
              <option>عالية</option><option>متوسطة</option><option>منخفضة</option>
            </select>
            <input
              placeholder="موعد التسليم"
              value={newTask.due}
              onChange={e => setNewTask({...newTask, due: e.target.value})}
              className="col-span-2 px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
            />
            <button
              onClick={addTask}
              className="col-span-1 bg-[#3d7a4f] text-white rounded-xl text-sm font-body hover:bg-[#2a5236] transition"
            >
              إضافة
            </button>
          </div>
        </Card>
      )}

      {/* Team filter chips */}
      <div className="flex items-center gap-2">
        <Filter size={14} className="text-[#857961]"/>
        <button
          onClick={() => setFilterTeam('all')}
          className={`px-3.5 py-1.5 rounded-full text-sm font-body transition ${
            filterTeam === 'all'
              ? 'bg-[#1a1d2e] text-[#fbf8f0]'
              : 'bg-transparent border border-[#e8e1cf] text-[#1a1d2e] hover:bg-[#fbf8f0]'
          }`}
        >
          كل الفرق
        </button>
        {Object.values(TEAMS).map(t => (
          <button
            key={t.id}
            onClick={() => setFilterTeam(t.id)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-body transition border ${
              filterTeam === t.id ? '' : 'hover:bg-[#fbf8f0]'
            }`}
            style={{
              background: filterTeam === t.id ? t.color : 'transparent',
              color: filterTeam === t.id ? '#fbf8f0' : t.color,
              borderColor: t.color,
            }}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Tasks table */}
      <Card className="overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#e8e1cf] bg-[#f5f1e3]">
              {['المهمة', 'الموظف', 'الفريق', 'الأولوية', 'الحالة', 'التسليم', ''].map(h => (
                <th key={h} className="text-right px-5 py-3 text-xs uppercase tracking-wider text-[#857961] font-body font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((task, i) => {
              const emp = EMPLOYEES.find(e => e.id === task.assignee);
              const team = TEAMS[task.team];
              return (
                <tr key={task.id} className="border-b border-[#e8e1cf] last:border-0 hover:bg-[#f5f1e3]/50 transition anim-slide" style={{ animationDelay: `${i * 30}ms` }}>
                  <td className="px-5 py-4 font-body text-[#1a1d2e] text-sm">{task.title}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <Avatar emp={emp} size={30}/>
                      <span className="font-body text-sm text-[#1a1d2e]">{emp.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-1.5 text-xs font-body" style={{ color: team.color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: team.color }}/>
                      {team.name}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="font-body text-sm" style={{ color: PRIORITY_STYLES[task.priority] }}>
                      {task.priority}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <button onClick={() => cycleStatus(task.id)}>
                      <Pill status={task.status}>{task.status}</Pill>
                    </button>
                  </td>
                  <td className="px-5 py-4 text-sm text-[#857961] font-body">{task.due}</td>
                  <td className="px-5 py-4">
                    <button className="text-[#857961] hover:text-[#1a1d2e]">
                      <MoreHorizontal size={16}/>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

// ─── Leave requests (moderator) ──────────────────────────────
const ModeratorLeaves = ({ leaves, setLeaves }) => {
  const [tab, setTab] = useState('معلقة');

  const filtered = leaves.filter(l => l.status === tab);
  const counts = {
    'معلقة':   leaves.filter(l => l.status === 'معلقة').length,
    'مقبولة':  leaves.filter(l => l.status === 'مقبولة').length,
    'مرفوضة':  leaves.filter(l => l.status === 'مرفوضة').length,
  };

  const decide = (id, status) => {
    setLeaves(leaves.map(l => l.id === id ? { ...l, status } : l));
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="LEAVES · طلبات الإجازة"
        title="مراجعة طلبات الإجازات"
      />

      <div className="flex items-center gap-1 border-b border-[#e8e1cf]">
        {Object.entries(counts).map(([k, v]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-5 py-3 text-sm font-body relative transition ${
              tab === k ? 'text-[#1a1d2e]' : 'text-[#857961] hover:text-[#1a1d2e]'
            }`}
          >
            {k} <span className="text-xs">({v})</span>
            {tab === k && (
              <div className="absolute bottom-0 right-0 left-0 h-0.5 bg-[#1a1d2e]"/>
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {filtered.length === 0 && (
          <div className="col-span-2 text-center py-16 text-[#857961] font-body">
            لا توجد طلبات في هذه الفئة
          </div>
        )}
        {filtered.map((leave, i) => {
          const emp = EMPLOYEES.find(e => e.id === leave.employee);
          const team = TEAMS[emp.team];
          return (
            <Card key={leave.id} className="p-5 anim-slide" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-3">
                  <Avatar emp={emp} size={44}/>
                  <div>
                    <div className="font-display text-base text-[#1a1d2e]">{emp.name}</div>
                    <div className="text-xs text-[#857961] font-body mt-0.5">
                      {emp.role} · {team.name}
                    </div>
                  </div>
                </div>
                <Pill status={leave.status}>{leave.status}</Pill>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4 p-3 bg-[#f5f1e3] rounded-xl">
                <div>
                  <div className="text-xs text-[#857961] font-body mb-1">نوع الإجازة</div>
                  <div className="font-body text-sm text-[#1a1d2e]">{leave.type}</div>
                </div>
                <div>
                  <div className="text-xs text-[#857961] font-body mb-1">المدة</div>
                  <div className="font-body text-sm text-[#1a1d2e]">{leave.days} أيام</div>
                </div>
                <div>
                  <div className="text-xs text-[#857961] font-body mb-1">من</div>
                  <div className="font-body text-sm text-[#1a1d2e]">{leave.from}</div>
                </div>
                <div>
                  <div className="text-xs text-[#857961] font-body mb-1">إلى</div>
                  <div className="font-body text-sm text-[#1a1d2e]">{leave.to}</div>
                </div>
              </div>

              <div className="text-xs text-[#857961] font-body mb-1">السبب</div>
              <div className="font-body text-sm text-[#1a1d2e] mb-4">{leave.reason}</div>

              {leave.status === 'معلقة' && (
                <div className="flex gap-2 pt-3 border-t border-[#e8e1cf]">
                  <button
                    onClick={() => decide(leave.id, 'مقبولة')}
                    className="flex-1 flex items-center justify-center gap-2 bg-[#3d7a4f] text-white py-2.5 rounded-xl text-sm font-body hover:bg-[#2a5236] transition"
                  >
                    <Check size={15}/> قبول
                  </button>
                  <button
                    onClick={() => decide(leave.id, 'مرفوضة')}
                    className="flex-1 flex items-center justify-center gap-2 bg-transparent border border-[#8b3a4e] text-[#8b3a4e] py-2.5 rounded-xl text-sm font-body hover:bg-[#ecd9de] transition"
                  >
                    <X size={15}/> رفض
                  </button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

// ─── Teams (moderator) ──────────────────────────────────────
const ModeratorTeams = ({ tasks }) => {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="TEAMS · الفرق"
        title="فرق العمل وأعضاؤها"
      />

      <div className="grid grid-cols-3 gap-4">
        {Object.values(TEAMS).map((team, ti) => {
          const Icon = team.icon;
          const members = EMPLOYEES.filter(e => e.team === team.id);
          const teamTasks = tasks.filter(t => t.team === team.id);
          const done = teamTasks.filter(t => t.status === 'مكتملة').length;
          return (
            <Card key={team.id} className="overflow-hidden anim-slide" style={{ animationDelay: `${ti * 100}ms` }}>
              <div className="p-5 border-b border-[#e8e1cf]" style={{ background: team.soft }}>
                <div className="flex items-center justify-between mb-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{ background: team.color, color: team.soft }}
                  >
                    <Icon size={20}/>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-2xl font-semibold" style={{ color: team.color }}>
                      {members.length}
                    </div>
                    <div className="text-xs font-body" style={{ color: team.color }}>أعضاء</div>
                  </div>
                </div>
                <div className="font-display text-xl" style={{ color: team.color }}>{team.name}</div>
                <div className="text-xs font-body mt-1" style={{ color: team.color, opacity: 0.7 }}>
                  {done}/{teamTasks.length} مهمة مكتملة
                </div>
              </div>
              <div className="p-3 space-y-1">
                {members.map(m => (
                  <div key={m.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#f5f1e3] transition">
                    <Avatar emp={m} size={34}/>
                    <div className="flex-1 min-w-0">
                      <div className="font-body text-sm text-[#1a1d2e] truncate">{m.name}</div>
                      <div className="text-xs text-[#857961] font-body truncate">{m.role}</div>
                    </div>
                    <div className="text-xs font-display font-semibold" style={{ color: team.color }}>
                      {m.score}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// EMPLOYEE VIEWS  (currently logged in: employee #1, Mohamed Ahmed)
// ─────────────────────────────────────────────────────────────
const CURRENT_EMPLOYEE_ID = 1;

const EmployeeOverview = ({ tasks, leaves }) => {
  const me = EMPLOYEES.find(e => e.id === CURRENT_EMPLOYEE_ID);
  const myTasks = tasks.filter(t => t.assignee === CURRENT_EMPLOYEE_ID);
  const myLeaves = leaves.filter(l => l.employee === CURRENT_EMPLOYEE_ID);
  const team = TEAMS[me.team];

  const inProgress = myTasks.filter(t => t.status === 'قيد التنفيذ').length;
  const completed = myTasks.filter(t => t.status === 'مكتملة').length;

  return (
    <div className="space-y-8">
      {/* hero */}
      <Card className="relative overflow-hidden p-8" style={{ background: 'linear-gradient(135deg, #1a1d2e 0%, #2a2d3e 100%)' }}>
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full opacity-10" style={{ background: team.color, transform: 'translate(40%, -40%)' }}/>
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full opacity-5" style={{ background: '#f5f1e3', transform: 'translate(-30%, 30%)' }}/>
        <div className="relative">
          <div className="text-xs uppercase tracking-[0.25em] text-[#a86b2c] font-latin-serif mb-3">
            WELCOME BACK
          </div>
          <h1 className="font-display text-4xl text-[#fbf8f0] mb-2">أهلاً، {me.name}</h1>
          <div className="text-[#a8a3a3] font-body text-sm">
            {me.role} · فريق {team.name}
          </div>
          <div className="flex items-center gap-6 mt-6">
            <div>
              <div className="text-3xl font-display font-semibold text-[#fbf8f0]">{me.score}</div>
              <div className="text-xs text-[#a8a3a3] font-body mt-1">معدّل الأداء</div>
            </div>
            <div className="w-px h-12 bg-[#fbf8f0]/20"/>
            <div>
              <div className="text-3xl font-display font-semibold text-[#fbf8f0]">{myTasks.length}</div>
              <div className="text-xs text-[#a8a3a3] font-body mt-1">مهمة هذا الشهر</div>
            </div>
            <div className="w-px h-12 bg-[#fbf8f0]/20"/>
            <div>
              <div className="text-3xl font-display font-semibold text-[#fbf8f0]">{completed}</div>
              <div className="text-xs text-[#a8a3a3] font-body mt-1">مهمة مكتملة</div>
            </div>
          </div>
        </div>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-[#857961] font-body mb-2">
            <Clock size={13}/> مهام جارية
          </div>
          <div className="font-display text-3xl text-[#1a1d2e]">{inProgress}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-[#857961] font-body mb-2">
            <CalendarDays size={13}/> طلبات إجازة هذا العام
          </div>
          <div className="font-display text-3xl text-[#1a1d2e]">{myLeaves.length}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-[#857961] font-body mb-2">
            <Award size={13}/> ترتيبك في الفريق
          </div>
          <div className="font-display text-3xl text-[#1a1d2e]">
            ٢<span className="text-base text-[#857961]">/4</span>
          </div>
        </Card>
      </div>

      {/* My current tasks */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl text-[#1a1d2e]">مهامي الحالية</h3>
          <span className="text-xs text-[#857961] font-body">{myTasks.length} مهمة</span>
        </div>
        <div className="space-y-2">
          {myTasks.map((t, i) => (
            <Card key={t.id} className="p-4 flex items-center gap-4 anim-slide" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="w-1 h-10 rounded-full" style={{ background: PRIORITY_STYLES[t.priority] }}/>
              <div className="flex-1">
                <div className="font-body text-[#1a1d2e]">{t.title}</div>
                <div className="text-xs text-[#857961] font-body mt-1">التسليم: {t.due}</div>
              </div>
              <Pill status={t.status}>{t.status}</Pill>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

const EmployeeLeave = ({ leaves, setLeaves }) => {
  const myLeaves = leaves.filter(l => l.employee === CURRENT_EMPLOYEE_ID);
  const [form, setForm] = useState({ type: 'إجازة اعتيادية', from: '', to: '', days: 1, reason: '' });

  const submit = () => {
    if (!form.from || !form.to || !form.reason) return;
    setLeaves([
      ...leaves,
      {
        id: Date.now(),
        employee: CURRENT_EMPLOYEE_ID,
        ...form,
        status: 'معلقة'
      }
    ]);
    setForm({ type: 'إجازة اعتيادية', from: '', to: '', days: 1, reason: '' });
  };

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="MY LEAVES · إجازاتي"
        title="تقديم طلب إجازة"
      />

      <div className="grid grid-cols-5 gap-6">
        {/* Form */}
        <Card className="p-6 col-span-3">
          <div className="font-display text-lg text-[#1a1d2e] mb-5">طلب إجازة جديد</div>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-[#857961] font-body mb-1.5 block">نوع الإجازة</label>
              <select
                value={form.type}
                onChange={e => setForm({...form, type: e.target.value})}
                className="w-full px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
              >
                <option>إجازة اعتيادية</option>
                <option>إجازة مرضية</option>
                <option>إجازة طارئة</option>
                <option>إجازة بدون مرتب</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-[#857961] font-body mb-1.5 block">من تاريخ</label>
                <input
                  type="text"
                  placeholder="٣ يونيو"
                  value={form.from}
                  onChange={e => setForm({...form, from: e.target.value})}
                  className="w-full px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
                />
              </div>
              <div>
                <label className="text-xs text-[#857961] font-body mb-1.5 block">إلى تاريخ</label>
                <input
                  type="text"
                  placeholder="٥ يونيو"
                  value={form.to}
                  onChange={e => setForm({...form, to: e.target.value})}
                  className="w-full px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
                />
              </div>
              <div>
                <label className="text-xs text-[#857961] font-body mb-1.5 block">عدد الأيام</label>
                <input
                  type="number"
                  min={1}
                  value={form.days}
                  onChange={e => setForm({...form, days: Number(e.target.value)})}
                  className="w-full px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-[#857961] font-body mb-1.5 block">السبب</label>
              <textarea
                rows={3}
                placeholder="اذكر سبب طلب الإجازة..."
                value={form.reason}
                onChange={e => setForm({...form, reason: e.target.value})}
                className="w-full px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e] resize-none"
              />
            </div>

            <button
              onClick={submit}
              className="w-full bg-[#1a1d2e] text-[#fbf8f0] py-3 rounded-xl text-sm font-body hover:bg-[#2a2d3e] transition flex items-center justify-center gap-2"
            >
              <Sparkles size={15}/>
              تقديم الطلب
            </button>
          </div>
        </Card>

        {/* History */}
        <Card className="p-6 col-span-2">
          <div className="font-display text-lg text-[#1a1d2e] mb-5">سجل طلباتي</div>
          <div className="space-y-3">
            {myLeaves.length === 0 && (
              <div className="text-center py-8 text-[#857961] font-body text-sm">
                لا توجد طلبات سابقة
              </div>
            )}
            {myLeaves.map(l => (
              <div key={l.id} className="p-3 bg-[#f5f1e3] rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-body text-sm text-[#1a1d2e]">{l.type}</span>
                  <Pill status={l.status}>{l.status}</Pill>
                </div>
                <div className="text-xs text-[#857961] font-body">
                  {l.from} → {l.to} · {l.days} أيام
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

const EmployeePerformance = () => {
  const me = EMPLOYEES.find(e => e.id === CURRENT_EMPLOYEE_ID);
  const team = TEAMS[me.team];

  const metrics = [
    { label: 'الالتزام بالمواعيد', value: 94, color: '#3d7a4f' },
    { label: 'جودة العمل',          value: 88, color: '#a86b2c' },
    { label: 'التعاون مع الفريق',  value: 95, color: '#2d5d6e' },
    { label: 'المبادرة',            value: 82, color: '#8b3a4e' },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="PRIVATE · تقييم خاص بك"
        title="أداؤك وتقييمك"
        action={
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#dce8df] rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-[#3d7a4f] animate-pulse"/>
            <span className="text-xs text-[#2a5236] font-body">هذه الصفحة مرئية لك فقط</span>
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-4">
        {/* Overall score */}
        <Card className="p-6 relative overflow-hidden">
          <div className="text-xs uppercase tracking-[0.2em] text-[#857961] font-latin-serif mb-1">OVERALL SCORE</div>
          <div className="font-display text-base text-[#1a1d2e] mb-4">المعدّل العام</div>
          <ResponsiveContainer width="100%" height={170}>
            <RadialBarChart
              innerRadius="65%"
              outerRadius="100%"
              data={[{ name: 'score', value: me.score, fill: team.color }]}
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false}/>
              <RadialBar dataKey="value" cornerRadius={20} background={{ fill: '#e8e1cf' }}/>
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-x-0 top-[58%] text-center">
            <div className="font-display text-5xl font-semibold" style={{ color: team.color }}>{me.score}</div>
            <div className="text-xs text-[#857961] font-body mt-0.5">من 100</div>
          </div>
        </Card>

        {/* Weekly */}
        <Card className="p-6 col-span-2">
          <div className="text-xs uppercase tracking-[0.2em] text-[#857961] font-latin-serif mb-1">THIS WEEK</div>
          <div className="font-display text-base text-[#1a1d2e] mb-4">أداؤك هذا الأسبوع</div>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={PERF_WEEKLY}>
              <CartesianGrid strokeDasharray="2 4" stroke="#e8e1cf" vertical={false}/>
              <XAxis dataKey="d" stroke="#857961" fontSize={11} tickLine={false} axisLine={false} reversed/>
              <YAxis stroke="#857961" fontSize={11} tickLine={false} axisLine={false} orientation="right" domain={[60, 100]}/>
              <Tooltip
                contentStyle={{
                  background: '#fbf8f0', border: '1px solid #e8e1cf',
                  borderRadius: 12, fontFamily: 'IBM Plex Sans Arabic'
                }}
              />
              <Line
                type="monotone"
                dataKey="val"
                stroke={team.color}
                strokeWidth={2.5}
                dot={{ fill: team.color, r: 4 }}
                activeDot={{ r: 6 }}
                name="النقاط"
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Detailed metrics */}
      <Card className="p-6">
        <div className="font-display text-lg text-[#1a1d2e] mb-5">تفصيل التقييم</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {metrics.map((m, i) => (
            <div key={i} className="anim-slide" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="flex items-baseline justify-between mb-2">
                <span className="font-body text-sm text-[#1a1d2e]">{m.label}</span>
                <span className="font-display text-xl font-semibold" style={{ color: m.color }}>
                  {m.value}<span className="text-sm text-[#857961]">/100</span>
                </span>
              </div>
              <div className="h-1.5 bg-[#e8e1cf] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${m.value}%`, background: m.color }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Feedback from manager */}
      <Card className="p-6 bg-[#f5f1e3]/60">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-[#1a1d2e] text-[#fbf8f0] flex items-center justify-center font-display">
            م
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-body text-sm text-[#1a1d2e] font-medium">المدير المباشر</span>
              <span className="text-xs text-[#857961] font-body">· قبل يومين</span>
            </div>
            <div className="font-body text-sm text-[#3d3d3d] leading-relaxed">
              أداء ممتاز هذا الشهر، ملاحظتي البسيطة هي الاهتمام بسرعة الاستجابة في تذاكر الدعم العاجلة.
              استمر بهذا المستوى وركّز على تنمية مهارات المبادرة.
            </div>
            <div className="flex items-center gap-1 mt-3">
              {[1,2,3,4,5].map(s => (
                <Star key={s} size={14} className={s <= 4 ? 'fill-[#a86b2c] text-[#a86b2c]' : 'text-[#e8e1cf]'}/>
              ))}
              <span className="text-xs text-[#857961] font-body mr-1">4.0 / 5.0</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// SHELL  (Sidebar + Header + Content)
// ─────────────────────────────────────────────────────────────
const NAV = {
  moderator: [
    { id: 'overview', label: 'النظرة العامة', icon: LayoutDashboard },
    { id: 'tasks',    label: 'المهام',        icon: ListTodo },
    { id: 'leaves',   label: 'طلبات الإجازة', icon: CalendarDays },
    { id: 'teams',    label: 'الفرق',         icon: Users },
  ],
  employee: [
    { id: 'overview',    label: 'الصفحة الرئيسية', icon: LayoutDashboard },
    { id: 'leave',       label: 'الإجازات',         icon: CalendarDays },
    { id: 'performance', label: 'تقييمي وأدائي',    icon: TrendingUp },
  ],
};

export default function App() {
  const [role, setRole] = useState('moderator');
  const [section, setSection] = useState('overview');

  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [leaves, setLeaves] = useState(INITIAL_LEAVES);

  const nav = NAV[role];
  const me = EMPLOYEES.find(e => e.id === CURRENT_EMPLOYEE_ID);

  // ensure section exists in current role nav
  React.useEffect(() => {
    if (!nav.find(n => n.id === section)) setSection(nav[0].id);
  }, [role]);

  const renderSection = () => {
    if (role === 'moderator') {
      if (section === 'overview') return <ModeratorOverview tasks={tasks} leaves={leaves}/>;
      if (section === 'tasks')    return <ModeratorTasks tasks={tasks} setTasks={setTasks}/>;
      if (section === 'leaves')   return <ModeratorLeaves leaves={leaves} setLeaves={setLeaves}/>;
      if (section === 'teams')    return <ModeratorTeams tasks={tasks}/>;
    } else {
      if (section === 'overview')    return <EmployeeOverview tasks={tasks} leaves={leaves}/>;
      if (section === 'leave')       return <EmployeeLeave leaves={leaves} setLeaves={setLeaves}/>;
      if (section === 'performance') return <EmployeePerformance/>;
    }
    return null;
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[#f5f1e3] font-body text-[#1a1d2e]">
      <FontStyles/>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 min-h-screen bg-[#fbf8f0] border-l border-[#e8e1cf] p-6 sticky top-0">
          {/* Brand */}
          <div className="mb-10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#1a1d2e] text-[#fbf8f0] flex items-center justify-center font-latin-serif text-lg font-bold">
                M
              </div>
              <div>
                <div className="font-display text-base text-[#1a1d2e] leading-tight">ميلاسيرف</div>
                <div className="text-[10px] text-[#857961] font-latin-serif tracking-wider">MILASERV · UPC</div>
              </div>
            </div>
          </div>

          {/* Nav */}
          <div className="text-[10px] uppercase tracking-[0.25em] text-[#857961] font-latin-serif mb-3 px-2">
            القائمة
          </div>
          <nav className="space-y-1 mb-8">
            {nav.map(item => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
                    active
                      ? 'bg-[#1a1d2e] text-[#fbf8f0]'
                      : 'text-[#1a1d2e] hover:bg-[#f5f1e3]'
                  }`}
                >
                  <Icon size={16}/>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Teams quick reference */}
          {role === 'moderator' && (
            <>
              <div className="text-[10px] uppercase tracking-[0.25em] text-[#857961] font-latin-serif mb-3 px-2">
                الفرق
              </div>
              <div className="space-y-1 mb-8">
                {Object.values(TEAMS).map(t => {
                  const Icon = t.icon;
                  const cnt = EMPLOYEES.filter(e => e.team === t.id).length;
                  return (
                    <div key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: t.soft, color: t.color }}>
                        <Icon size={13}/>
                      </div>
                      <span className="font-body text-[13px] text-[#1a1d2e] flex-1">{t.name}</span>
                      <span className="text-xs text-[#857961] font-latin-serif">{cnt}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* User */}
          <div className="absolute bottom-6 right-6 left-6">
            <div className="flex items-center gap-3 p-3 bg-[#f5f1e3] rounded-xl">
              <Avatar emp={me} size={36}/>
              <div className="flex-1 min-w-0">
                <div className="font-body text-sm text-[#1a1d2e] truncate">{me.name}</div>
                <div className="text-xs text-[#857961] font-body truncate">
                  {role === 'moderator' ? 'مدير النظام' : me.role}
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-h-screen">
          {/* Top bar with role switcher */}
          <div className="sticky top-0 z-10 bg-[#f5f1e3]/95 backdrop-blur-md border-b border-[#e8e1cf]">
            <div className="flex items-center justify-between px-10 py-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#857961]"/>
                  <input
                    placeholder="ابحث في النظام..."
                    className="w-80 pr-9 pl-4 py-2 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
                  />
                </div>
              </div>

              {/* Role switcher */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#857961] font-body">عرض كـ:</span>
                <div className="flex items-center bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl p-1">
                  <button
                    onClick={() => setRole('moderator')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-body transition ${
                      role === 'moderator'
                        ? 'bg-[#1a1d2e] text-[#fbf8f0]'
                        : 'text-[#857961] hover:text-[#1a1d2e]'
                    }`}
                  >
                    مودريتور
                  </button>
                  <button
                    onClick={() => setRole('employee')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-body transition ${
                      role === 'employee'
                        ? 'bg-[#1a1d2e] text-[#fbf8f0]'
                        : 'text-[#857961] hover:text-[#1a1d2e]'
                    }`}
                  >
                    موظف
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="px-10 py-8 max-w-[1200px]">
            {renderSection()}
          </div>
        </main>
      </div>
    </div>
  );
}
