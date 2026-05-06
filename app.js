// ════════════════════════════════════════════
//  PIPELINES
// ════════════════════════════════════════════
function makePostuladosTabs() {
  return [
    { id:'all', nombre:'Todos', sidebar:false,
      etapas:[
        {v:'New Lead',                  l:'New Lead'},
        {v:'1er intento de contacto',   l:'1er intento de contacto'},
        {v:'2do intento de contacto',   l:'2do intento de contacto'},
        {v:'3er intento de contacto',   l:'3er intento de contacto'},
      ]},
    { id:'1er', nombre:'1er intento de contacto', sidebar:true,
      etapas:[{v:'1er intento de contacto', l:'1er intento de contacto'}] },
    { id:'2do', nombre:'2do intento de contacto', sidebar:true,
      etapas:[{v:'2do intento de contacto', l:'2do intento de contacto'}] },
    { id:'3er', nombre:'3er intento de contacto', sidebar:true,
      etapas:[{v:'3er intento de contacto', l:'3er intento de contacto'}] },
  ];
}

const PIPELINES = [
  { id:'postulados-meta', nombre:'POSTULADOS POR META', icon:'📌', visible:true,
    tabs: makePostuladosTabs(),
    etapas:['New Lead','1er intento de contacto','2do intento de contacto','3er intento de contacto'] },
  { id:'postulados-indeed', nombre:'POSTULADOS POR INDEED', icon:'📋', visible:true,
    tabs: makePostuladosTabs(),
    etapas:['New Lead','1er intento de contacto','2do intento de contacto','3er intento de contacto'] },
  { id:'postulados-whatsapp-meta', nombre:'POSTULADOS POR WHATSAPP-META', icon:'💬', visible:true,
    tabs: makePostuladosTabs(),
    etapas:['New Lead','1er intento de contacto','2do intento de contacto','3er intento de contacto'] },
  { id:'en-webinar', nombre:'EN WEBINAR', icon:'🎥', visible:true,
    tabs: [
      { id:'inscrito', nombre:'Inscrito en Webinar', sidebar:false, tableView:true,
        etapas:[{v:'Inscrito en Webinar', l:'Inscrito en Webinar'}] },
      { id:'no-asistente', nombre:'No Asistente', sidebar:true, tableView:true,
        etapas:[
          {v:'NA - No Asistente',            l:'No Asistente'},
          {v:'NA - 1er intento de contacto', l:'1er intento de contacto'},
          {v:'NA - 2do intento de contacto', l:'2do intento de contacto'},
          {v:'NA - 3er intento de contacto', l:'3er intento de contacto'},
          {v:'NA - Reinscrito en Webinar',   l:'Reinscrito en Webinar'},
          {v:'NA - No contactado',           l:'No contactado'},
          {v:'NA - No interesado',           l:'No interesado'},
          {v:'NA - No Califica',             l:'No Califica'},
          {v:'NA - Para Entrevista',         l:'Para Entrevista'},
        ],
        subTabs: true,
        subTabVisible: ['NA - No Asistente','NA - 1er intento de contacto','NA - 2do intento de contacto','NA - 3er intento de contacto','NA - Reinscrito en Webinar'] },
      { id:'asistente', nombre:'Asistente', sidebar:true, tableView:true,
        etapas:[
          {v:'AS - Asistente',               l:'Asistente'},
          {v:'AS - 1er intento de contacto', l:'1er intento de contacto'},
          {v:'AS - 2do intento de contacto', l:'2do intento de contacto'},
          {v:'AS - 3er intento de contacto', l:'3er intento de contacto'},
          {v:'AS - No contactado',           l:'No contactado'},
          {v:'AS - No interesado',           l:'No interesado'},
          {v:'AS - No Califica',             l:'No Califica'},
          {v:'AS - Para Entrevista',         l:'Para Entrevista'},
        ],
        subTabs: true,
        subTabVisible: ['AS - Asistente','AS - 1er intento de contacto','AS - 2do intento de contacto','AS - 3er intento de contacto'] },
    ],
    etapas:['Inscrito en Webinar','NA - No Asistente','NA - 1er intento de contacto','NA - 2do intento de contacto','NA - 3er intento de contacto','NA - Reinscrito en Webinar','NA - No contactado','NA - No interesado','NA - No Califica','NA - Para Entrevista','AS - Asistente','AS - 1er intento de contacto','AS - 2do intento de contacto','AS - 3er intento de contacto','AS - No contactado','AS - No interesado','AS - No Califica','AS - Para Entrevista'] },
  { id:'entrevistas-generales', nombre:'ENTREVISTAS GENERALES', icon:'🤝', visible:true,
    etapas:['EN ENTREVISTA','NO SHOW','ENVIAR a Caritza Rojas','ENVIAR a Maria Lugo','ENVIAR a Bryan Palacios','Contratados Personales'] },
  { id:'maria-lugo', nombre:'ENTREVISTA: MARIA LUGO', icon:'👤', visible:false,
    etapas:['ENTREVISTADO','REAGENDADA','PENDING PAYMENT','CONTRATADO','NO INTERESADO - NO CALIFICA'] },
  { id:'brayan-alexander', nombre:'ENTREVISTA: BRAYAN & ALEXANDER', icon:'👤', visible:false,
    etapas:['ENTREVISTADO','REAGENDADA','PENDING PAYMENT','CONTRATADO','NO INTERESADO - NO CALIFICA'] },
  { id:'caritza-rojas', nombre:'ENTREVISTA: CARITZA ROJAS', icon:'👤', visible:false,
    etapas:['ENTREVISTADOS','REAGENDADA','PENDING PAYMENT','CONTRATADO','NO INTERESADO - NO CALIFICA'] },
  { id:'eliminados', nombre:'ELIMINADOS', icon:'🗑️', visible:true,
    etapas:['APLICANTE - NO CONTACTADO','APLICANTE - NO INTERESADO - NO CALIFICA','WEBINAR - NO CONTACTADO','WEBINAR - NO INTERESADO','ENTREVISTA - NO CONTACTADO','ENTREVISTA - NO INTERESADO'] },
  { id:'no-contactados', nombre:'NO CONTACTADOS', icon:'📵', visible:true,
    etapas:['Sin respuesta - 1er intento','Sin respuesta - 2do intento','Sin respuesta - 3er intento','Número incorrecto','Fuera de servicio'] },
  { id:'no-interesados-no-califica', nombre:'NO INTERESADOS / NO CALIFICA', icon:'🚫', visible:true,
    etapas:['No interesado','No califica - Sin documentos','No califica - Menor de edad','No califica - No habla Español','No califica - Otros'] },
];

// Stage color hints
function stageColor(etapa) {
  const e = etapa.toLowerCase();
  if (e.includes('new lead') || e.includes('inscrito')) return '#0073ea';
  if (e.includes('1er') || e.includes('2do') || e.includes('3er')) return '#fdab3d';
  if (e.includes('webinar') || e.includes('webianr')) return '#784bd1';
  if (e.includes('no contactado') || e.includes('no asistente') || e.includes('no show')) return '#676a82';
  if (e.includes('no interesado') || e.includes('no califica') || e.includes('eliminar')) return '#e2445c';
  if (e.includes('asistente')) return '#00bcd4';
  if (e.includes('para entrevista')) return '#00c875';
  if (e.includes('entrevistado') || e.includes('en entrevista') || e.includes('enviar')) return '#fdab3d';
  if (e.includes('contratado') || e.includes('ganado')) return '#00c875';
  if (e.includes('pending payment')) return '#ff9800';
  if (e.includes('reagendada')) return '#9c27b0';
  return '#676a82';
}

// ════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════
const SERVER_URL = localStorage.getItem('er_server_url') || 'https://elite-reclutamiento-production.up.railway.app';

let currentUser = { name:'Luis González', role:'Administrador' };
let activePipelineId = 'postulados-meta';
const webinarLink = 'https://crm.grupoelitework.com/webinar.html';
let activeView = 'kanban'; // 'kanban' | 'calendario'
if (new URLSearchParams(location.search).get('reset') === 'leads') {
  localStorage.removeItem('er_leads');
  location.replace(location.pathname);
}
let leads = JSON.parse(localStorage.getItem('er_leads') || '[]');
let currentLeadId = null;
let currentTags = [];
let dragLeadId = null;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let calWeekStart = _getWeekStart(new Date());
let pipeTabState = {};
function getPipelineTabs(pipe) {
  if (pipe.tabs) return pipe.tabs;
  const allTab = { id:'all', nombre:'Todos', sidebar:false, etapas: pipe.etapas.map(e => ({v:e, l:e})) };
  const stageTabs = pipe.etapas.map((e, i) => ({ id:'s'+i, nombre:e, sidebar:false, etapas:[{v:e, l:e}] }));
  return [allTab, ...stageTabs];
}
function getPipeTab(pipeId) {
  const pipe = PIPELINES.find(p => p.id === pipeId);
  const tabs = pipe ? getPipelineTabs(pipe) : null;
  if (!tabs) return null;
  return pipeTabState[pipeId] || tabs[0].id;
}
function setPipeTab(pipeId, tabId) { pipeTabState[pipeId] = tabId; }

let subTabState = {};
function getSubTab(pipeId, tabId) { return subTabState[`${pipeId}:${tabId}`] || 'all'; }
function setSubTab(pipeId, tabId, subId) { subTabState[`${pipeId}:${tabId}`] = subId; }
function selectSubTab(pipeId, tabId, subId) { setSubTab(pipeId, tabId, subId); renderKanban(); }

const WEBINAR_PROGRESSIONS = {
  'NA - No Asistente':            'NA - 1er intento de contacto',
  'NA - 1er intento de contacto': 'NA - 2do intento de contacto',
  'NA - 2do intento de contacto': 'NA - 3er intento de contacto',
  'NA - 3er intento de contacto': null,
  'AS - Asistente':               'AS - 1er intento de contacto',
  'AS - 1er intento de contacto': 'AS - 2do intento de contacto',
  'AS - 2do intento de contacto': 'AS - 3er intento de contacto',
  'AS - 3er intento de contacto': null,
};

// Users managed server-side — no local USERS array

// Load some sample data if empty or seed version changed
const SEED_VERSION = '4';
const _d = daysAgo => { const dt = new Date(); dt.setDate(dt.getDate()-daysAgo); return dt.toISOString(); };
if (localStorage.getItem('er_seed_v') !== SEED_VERSION) {
  leads = [];
  const sample = [
    // ── POSTULADOS POR META (10) ──
    { nombre:'Carlos Mendoza',     correo:'carlos.mendoza@gmail.com',    telefono:'+52 55 1234 5678', fuente:'Meta / Facebook', ubicacion:'CDMX', pipeline_id:'postulados-meta', etapa:'New Lead',                 estado:'abierto', valor:0, propietario:'Luis González',  nombre_lead:'Asesor Comercial',    etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(1) },
    { nombre:'Ana Sofía García',   correo:'anasofia.g@hotmail.com',      telefono:'+52 55 8765 4321', fuente:'Meta / Facebook', ubicacion:'Monterrey', pipeline_id:'postulados-meta', etapa:'New Lead',            estado:'abierto', valor:0, propietario:'Luis González',  nombre_lead:'Ejecutiva de Ventas', etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(2) },
    { nombre:'Roberto Silva',      correo:'roberto.silva@gmail.com',     telefono:'+52 81 9999 0000', fuente:'Meta / Facebook', ubicacion:'Monterrey', pipeline_id:'postulados-meta', etapa:'New Lead',            estado:'abierto', valor:0, propietario:'Maria Lugo',     nombre_lead:'Coordinador',         etiquetas:[], notas:[{texto:'Le interesa el esquema remoto',fecha:_d(3),autor:'Maria Lugo'}], tareas:[], pagos:[], created_at:_d(3) },
    { nombre:'Laura Torres',       correo:'l.torres22@gmail.com',        telefono:'+52 55 1111 2222', fuente:'Meta / Facebook', ubicacion:'Guadalajara', pipeline_id:'postulados-meta', etapa:'1er intento de contacto', estado:'abierto', valor:0, propietario:'Luis González', nombre_lead:'Ejecutiva',     etiquetas:['calificado'], notas:[], tareas:[{id:'t1',texto:'Llamar 10am',done:false}], pagos:[], created_at:_d(4) },
    { nombre:'Miguel Ángel Reyes', correo:'mreyes.mx@gmail.com',         telefono:'+52 55 3333 4444', fuente:'Meta / Facebook', ubicacion:'CDMX',      pipeline_id:'postulados-meta', etapa:'1er intento de contacto', estado:'abierto', valor:0, propietario:'Caritza Rojas', nombre_lead:'Asesor',       etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(5) },
    { nombre:'Paola Hernández',    correo:'paola.hdz@outlook.com',       telefono:'+52 33 2222 9876', fuente:'Meta / Facebook', ubicacion:'Guadalajara', pipeline_id:'postulados-meta', etapa:'1er intento de contacto', estado:'abierto', valor:0, propietario:'Maria Lugo', nombre_lead:'Asesora SR',     etiquetas:[], notas:[{texto:'Sin respuesta, dejar recado',fecha:_d(6),autor:'Maria Lugo'}], tareas:[], pagos:[], created_at:_d(6) },
    { nombre:'Sergio Núñez',       correo:'s.nunez.ceo@gmail.com',       telefono:'+52 55 4444 5555', fuente:'Meta / Facebook', ubicacion:'CDMX',      pipeline_id:'postulados-meta', etapa:'2do intento de contacto', estado:'abierto', valor:0, propietario:'Luis González', nombre_lead:'Gerente Zona', etiquetas:['urgente'], notas:[], tareas:[], pagos:[], created_at:_d(7) },
    { nombre:'Daniela Ramos',      correo:'dani.ramos@gmail.com',        telefono:'+52 81 6666 7777', fuente:'Meta / Facebook', ubicacion:'Monterrey', pipeline_id:'postulados-meta', etapa:'2do intento de contacto', estado:'abierto', valor:0, propietario:'Caritza Rojas', nombre_lead:'Promotora',    etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(9) },
    { nombre:'Javier Flores',      correo:'javier.flores.ok@gmail.com',  telefono:'+52 33 8888 1212', fuente:'Meta / Facebook', ubicacion:'Guadalajara', pipeline_id:'postulados-meta', etapa:'3er intento de contacto', estado:'abierto', valor:0, propietario:'Maria Lugo', nombre_lead:'Asesor Jr',     etiquetas:[], notas:[{texto:'2do intento sin respuesta',fecha:_d(10),autor:'Maria Lugo'}], tareas:[], pagos:[], created_at:_d(12) },
    { nombre:'Valeria Castillo',   correo:'vale.castillo@hotmail.com',   telefono:'+52 55 9090 1234', fuente:'Meta / Facebook', ubicacion:'CDMX',      pipeline_id:'postulados-meta', etapa:'3er intento de contacto', estado:'abierto', valor:0, propietario:'Luis González', nombre_lead:'Ejecutiva SR', etiquetas:['calificado'], notas:[], tareas:[], pagos:[], created_at:_d(14) },

    // ── POSTULADOS POR INDEED (10) ──
    { nombre:'Eduardo Guzmán',     correo:'eduguzman.work@gmail.com',    telefono:'+52 55 2211 3344', fuente:'OCC / Indeed', ubicacion:'CDMX',        pipeline_id:'postulados-indeed', etapa:'New Lead',                 estado:'abierto', valor:0, propietario:'Luis González',  nombre_lead:'Asesor Ventas',       etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(1) },
    { nombre:'Mariana Ortega',     correo:'mariana.o.mx@gmail.com',      telefono:'+52 81 5566 7788', fuente:'OCC / Indeed', ubicacion:'Monterrey',   pipeline_id:'postulados-indeed', etapa:'New Lead',                 estado:'abierto', valor:0, propietario:'Caritza Rojas', nombre_lead:'Coordinadora',        etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(2) },
    { nombre:'Óscar Vázquez',      correo:'oscar.vz@outlook.com',        telefono:'+52 33 4455 6677', fuente:'OCC / Indeed', ubicacion:'Guadalajara', pipeline_id:'postulados-indeed', etapa:'New Lead',                 estado:'abierto', valor:0, propietario:'Maria Lugo',     nombre_lead:'Ejecutivo',           etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(3) },
    { nombre:'Karla Jiménez',      correo:'karla.jim88@gmail.com',       telefono:'+52 55 7788 9900', fuente:'OCC / Indeed', ubicacion:'CDMX',        pipeline_id:'postulados-indeed', etapa:'1er intento de contacto',  estado:'abierto', valor:0, propietario:'Luis González',  nombre_lead:'Promotora',           etiquetas:['calificado'], notas:[], tareas:[], pagos:[], created_at:_d(4) },
    { nombre:'Iván Morales',       correo:'ivan.morales.v@gmail.com',    telefono:'+52 81 3322 1100', fuente:'OCC / Indeed', ubicacion:'Monterrey',   pipeline_id:'postulados-indeed', etapa:'1er intento de contacto',  estado:'abierto', valor:0, propietario:'Caritza Rojas', nombre_lead:'Asesor SR',           etiquetas:[], notas:[{texto:'Llamada en espera de respuesta',fecha:_d(5),autor:'Caritza Rojas'}], tareas:[], pagos:[], created_at:_d(5) },
    { nombre:'Natalia Espinosa',   correo:'naty.espinosa@hotmail.com',   telefono:'+52 33 9988 7766', fuente:'OCC / Indeed', ubicacion:'Guadalajara', pipeline_id:'postulados-indeed', etapa:'1er intento de contacto',  estado:'abierto', valor:0, propietario:'Maria Lugo',     nombre_lead:'Ejecutiva',           etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(6) },
    { nombre:'Arturo Peña',        correo:'arturo.pena.mx@gmail.com',    telefono:'+52 55 6677 8899', fuente:'OCC / Indeed', ubicacion:'CDMX',        pipeline_id:'postulados-indeed', etapa:'2do intento de contacto',  estado:'abierto', valor:0, propietario:'Luis González',  nombre_lead:'Gerente Comercial',   etiquetas:['urgente'], notas:[], tareas:[], pagos:[], created_at:_d(8) },
    { nombre:'Sofía Ramírez',      correo:'sofia.r.ventas@gmail.com',    telefono:'+52 81 5544 3322', fuente:'OCC / Indeed', ubicacion:'Monterrey',   pipeline_id:'postulados-indeed', etapa:'2do intento de contacto',  estado:'abierto', valor:0, propietario:'Caritza Rojas', nombre_lead:'Asesora',             etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(10) },
    { nombre:'Luis Pacheco',       correo:'luispachecog@gmail.com',      telefono:'+52 33 7766 5544', fuente:'OCC / Indeed', ubicacion:'Guadalajara', pipeline_id:'postulados-indeed', etapa:'3er intento de contacto',  estado:'abierto', valor:0, propietario:'Maria Lugo',     nombre_lead:'Asesor Comercial',    etiquetas:[], notas:[{texto:'3er intento, no contesta',fecha:_d(12),autor:'Maria Lugo'}], tareas:[], pagos:[], created_at:_d(13) },
    { nombre:'Andrea Vargas',      correo:'andrea.vargas.ok@gmail.com',  telefono:'+52 55 1100 2233', fuente:'OCC / Indeed', ubicacion:'CDMX',        pipeline_id:'postulados-indeed', etapa:'3er intento de contacto',  estado:'abierto', valor:0, propietario:'Luis González',  nombre_lead:'Ejecutiva JR',        etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(15) },

    // ── POSTULADOS POR WHATSAPP-META (10) ──
    { nombre:'Fernando Ríos',      correo:'f.rios.mx@gmail.com',         telefono:'+52 55 4433 2211', fuente:'WhatsApp', ubicacion:'CDMX',            pipeline_id:'postulados-whatsapp-meta', etapa:'New Lead',                 estado:'abierto', valor:0, propietario:'Luis González',  nombre_lead:'Asesor Ventas',    etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(1) },
    { nombre:'Alejandra Cruz',     correo:'ale.cruz.ventas@gmail.com',   telefono:'+52 81 9900 8877', fuente:'WhatsApp', ubicacion:'Monterrey',       pipeline_id:'postulados-whatsapp-meta', etapa:'New Lead',                 estado:'abierto', valor:0, propietario:'Caritza Rojas', nombre_lead:'Ejecutiva',        etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(2) },
    { nombre:'Ricardo Leal',       correo:'ricleal.pro@outlook.com',     telefono:'+52 33 8877 6655', fuente:'WhatsApp', ubicacion:'Guadalajara',     pipeline_id:'postulados-whatsapp-meta', etapa:'New Lead',                 estado:'abierto', valor:0, propietario:'Maria Lugo',     nombre_lead:'Coordinador',      etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(2) },
    { nombre:'Gabriela Soto',      correo:'gaby.soto.w@gmail.com',       telefono:'+52 55 3322 4455', fuente:'WhatsApp', ubicacion:'CDMX',            pipeline_id:'postulados-whatsapp-meta', etapa:'1er intento de contacto',  estado:'abierto', valor:0, propietario:'Luis González',  nombre_lead:'Asesora SR',       etiquetas:['calificado'], notas:[], tareas:[], pagos:[], created_at:_d(4) },
    { nombre:'Héctor Domínguez',   correo:'hector.dom.mx@gmail.com',     telefono:'+52 81 2211 0099', fuente:'WhatsApp', ubicacion:'Monterrey',       pipeline_id:'postulados-whatsapp-meta', etapa:'1er intento de contacto',  estado:'abierto', valor:0, propietario:'Caritza Rojas', nombre_lead:'Asesor',           etiquetas:[], notas:[{texto:'Respondió WhatsApp, pendiente llamada',fecha:_d(5),autor:'Caritza Rojas'}], tareas:[], pagos:[], created_at:_d(5) },
    { nombre:'Mónica Aguilar',     correo:'monica.aguilar.ok@gmail.com', telefono:'+52 33 5566 4433', fuente:'WhatsApp', ubicacion:'Guadalajara',     pipeline_id:'postulados-whatsapp-meta', etapa:'1er intento de contacto',  estado:'abierto', valor:0, propietario:'Maria Lugo',     nombre_lead:'Promotora',        etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(6) },
    { nombre:'Jorge Salazar',      correo:'j.salazar.crm@gmail.com',     telefono:'+52 55 7788 6655', fuente:'WhatsApp', ubicacion:'CDMX',            pipeline_id:'postulados-whatsapp-meta', etapa:'2do intento de contacto',  estado:'abierto', valor:0, propietario:'Luis González',  nombre_lead:'Ejecutivo SR',     etiquetas:['urgente'], notas:[], tareas:[], pagos:[], created_at:_d(7) },
    { nombre:'Paulina Medina',     correo:'paulina.med.v@hotmail.com',   telefono:'+52 81 4433 5566', fuente:'WhatsApp', ubicacion:'Monterrey',       pipeline_id:'postulados-whatsapp-meta', etapa:'2do intento de contacto',  estado:'abierto', valor:0, propietario:'Caritza Rojas', nombre_lead:'Coordinadora',     etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(9) },
    { nombre:'Andrés Fuentes',     correo:'andres.fuentes.pro@gmail.com',telefono:'+52 33 6655 7788', fuente:'WhatsApp', ubicacion:'Guadalajara',     pipeline_id:'postulados-whatsapp-meta', etapa:'3er intento de contacto',  estado:'abierto', valor:0, propietario:'Maria Lugo',     nombre_lead:'Asesor Comercial', etiquetas:[], notas:[{texto:'No ha contestado en 3 intentos',fecha:_d(11),autor:'Maria Lugo'}], tareas:[], pagos:[], created_at:_d(13) },
    { nombre:'Claudia Ibarra',     correo:'claudia.ibarra.mx@gmail.com', telefono:'+52 55 8899 7766', fuente:'WhatsApp', ubicacion:'CDMX',            pipeline_id:'postulados-whatsapp-meta', etapa:'3er intento de contacto',  estado:'abierto', valor:0, propietario:'Luis González',  nombre_lead:'Ejecutiva',        etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(16) },

    // ── OTROS (webinar, entrevistas) ──
    { nombre:'Patricia Ruiz',      correo:'patricia@email.com',          telefono:'+52 55 5555 6666', fuente:'Referido',         ubicacion:'CDMX',      pipeline_id:'en-webinar', etapa:'Inscrito en Webinar', estado:'abierto', valor:0, propietario:'Luis González', nombre_lead:'Coordinadora', etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(3) },
    { nombre:'Sandra López',       correo:'sandra@email.com',            telefono:'+52 55 0001 1234', fuente:'Meta / Facebook',  ubicacion:'Monterrey', pipeline_id:'entrevistas-generales', etapa:'EN ENTREVISTA', estado:'abierto', valor:0, propietario:'Caritza Rojas', nombre_lead:'Asesora Senior', etiquetas:[], notas:[], tareas:[], pagos:[], created_at:_d(5) },
  ].map((l,i) => ({ id: 'lead-s'+i, ...l }));
  leads = sample;
  localStorage.setItem('er_leads', JSON.stringify(leads));
  localStorage.setItem('er_seed_v', SEED_VERSION);
}

// ════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════
let _sessionToken = null;
let _waPoller     = null;

function getRoleLabel(role) {
  return { developer:'Desarrollador', agente:'Agente', entrevistador:'Entrevistador' }[role] || role;
}
function getAllowedPipelines(role) {
  if (role === 'developer' || role === 'agente') return PIPELINES.map(p => p.id);
  if (role === 'entrevistador') return ['entrevistas-generales','maria-lugo','brayan-alexander','caritza-rojas'];
  return [];
}
function applyRolePermissions(role) {
  const show = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? '' : 'none'; };
  const is   = (...rs) => rs.includes(role);
  show('nav-conversations',    is('developer','agente'));
  show('nav-messaging',        is('developer','agente'));
  show('nav-wa-inbox',         is('developer','agente'));
  show('nav-external',         is('developer','entrevistador'));
  show('nav-registro-webinar', true);
  show('nav-team-chat',        is('developer','agente'));
  show('nav-ai',               is('developer','agente'));
  show('nav-ai-entrevistas',   true);
  show('nav-monitor',          is('developer','agente'));
  show('nav-config',           is('developer'));
  show('nav-users',            is('developer'));
}
function initAppWithUser(user) {
  currentUser   = { name: user.name, role: user.role };
  _sessionToken = user.token;
  document.getElementById('wa-verify-screen').style.display = 'none';
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-name').textContent   = user.name;
  document.getElementById('user-role').textContent   = getRoleLabel(user.role);
  document.getElementById('user-avatar').textContent = user.name[0];
  applyRolePermissions(user.role);
  populatePipelineSelects();
  renderSidebar();
  const allowed = getAllowedPipelines(user.role);
  const saved   = localStorage.getItem('er_active_pipeline');
  const pipe    = (saved && allowed.includes(saved)) ? saved : (allowed[0] || 'entrevistas-generales');
  const tab     = localStorage.getItem('er_active_tab');
  if (tab) setPipeTab(pipe, tab);
  selectPipeline(pipe);
  if (typeof postLoginInit === 'function') postLoginInit();
}
async function doLogin() {
  const email = document.getElementById('li-email').value.trim();
  const pass  = document.getElementById('li-pass').value;
  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('btn-login');
  errEl.textContent = '';
  if (!email || !pass) { errEl.textContent = 'Ingresa tu correo y contraseña.'; return; }
  btn.disabled = true; btn.textContent = 'Verificando…';
  try {
    const r    = await fetch(`${SERVER_URL}/auth/login`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await r.json();
    if (!data.ok) {
      errEl.textContent = data.error || 'Error al iniciar sesión.';
      btn.disabled = false; btn.textContent = 'Entrar'; return;
    }
    _sessionToken = data.sessionId;
    btn.disabled = false; btn.textContent = 'Entrar';
    // Developer (or pre-verified) → skip WA screen
    if (data.verified) {
      localStorage.setItem('er_session', JSON.stringify({ token: data.sessionId, name: data.name, role: data.role }));
      initAppWithUser({ token: data.sessionId, name: data.name, role: data.role });
      return;
    }
    document.getElementById('login-page').classList.add('hidden');
    const wsEl = document.getElementById('wa-verify-screen');
    wsEl.style.display = 'flex';
    document.getElementById('wa-verify-name').textContent = data.name.split(' ')[0];
    startWAPoller(data.sessionId);
  } catch(e) {
    errEl.textContent = 'Error de conexión con el servidor.';
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}
function startWAPoller(sessionId) {
  if (_waPoller) clearInterval(_waPoller);
  let attempts = 0;
  _waPoller = setInterval(async () => {
    if (++attempts > 200) {
      clearInterval(_waPoller);
      document.getElementById('wa-verify-error').textContent = 'Tiempo agotado. Intenta de nuevo.';
      setTimeout(cancelWAVerification, 2500); return;
    }
    try {
      const r    = await fetch(`${SERVER_URL}/auth/status/${sessionId}`);
      const data = await r.json();
      if (data.expired) { clearInterval(_waPoller); document.getElementById('wa-verify-error').textContent = 'Sesión expirada.'; return; }
      if (data.verified) {
        clearInterval(_waPoller);
        localStorage.setItem('er_session', JSON.stringify({ token: sessionId, name: data.name, role: data.role }));
        initAppWithUser({ token: sessionId, name: data.name, role: data.role });
      }
    } catch(e) {}
  }, 3000);
}
function cancelWAVerification() {
  if (_waPoller) clearInterval(_waPoller);
  document.getElementById('wa-verify-screen').style.display = 'none';
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('wa-verify-error').textContent = '';
}

// ── Users management (developer only) ────────────────────────────────────────
async function openUsersModal() {
  document.getElementById('users-modal').classList.remove('hidden');
  await loadUsersList();
}
function closeUsersModal() { document.getElementById('users-modal').classList.add('hidden'); }
async function loadUsersList() {
  const el = document.getElementById('users-list');
  el.innerHTML = '<div style="font-size:12px;color:var(--text3)">Cargando…</div>';
  try {
    const r    = await fetch(`${SERVER_URL}/auth/users`, { headers:{'x-session-token':_sessionToken} });
    const data = await r.json();
    if (!data.ok) { el.innerHTML = `<div style="color:var(--red);font-size:12px">${data.error}</div>`; return; }
    const RL = { developer:'Desarrollador', agente:'Agente', entrevistador:'Entrevistador' };
    el.innerHTML = data.users.map(u => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border-radius:8px;margin-bottom:6px;border:1px solid var(--border)">
        <div style="width:32px;height:32px;border-radius:50%;background:rgba(167,139,250,.2);color:#a78bfa;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0">${u.nombre[0]}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#fff">${u.nombre}</div>
          <div style="font-size:11px;color:var(--text3)">${u.correo} · ${u.telefono}</div>
        </div>
        <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:rgba(167,139,250,.15);color:#a78bfa">${RL[u.role]||u.role}</span>
        <button onclick="deleteUser('${u.id}','${u.nombre}')" style="background:rgba(226,68,92,.1);border:1px solid rgba(226,68,92,.25);color:var(--red);border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer">✕</button>
      </div>`).join('') || '<div style="font-size:12px;color:var(--text3)">Sin usuarios registrados.</div>';
  } catch(e) { el.innerHTML = `<div style="color:var(--red);font-size:12px">Error de conexión</div>`; }
}
async function createUser() {
  const nombre   = document.getElementById('nu-nombre').value.trim();
  const correo   = document.getElementById('nu-correo').value.trim();
  const telefono = document.getElementById('nu-telefono').value.trim();
  const password = document.getElementById('nu-password').value;
  const role     = document.getElementById('nu-role').value;
  const errEl    = document.getElementById('nu-error');
  errEl.textContent = '';
  if (!nombre||!correo||!telefono||!password) { errEl.textContent='Completa todos los campos.'; return; }
  try {
    const r    = await fetch(`${SERVER_URL}/auth/users`, {
      method:'POST', headers:{'Content-Type':'application/json','x-session-token':_sessionToken},
      body: JSON.stringify({ nombre, correo, telefono, password, role }),
    });
    const data = await r.json();
    if (!data.ok) { errEl.textContent = data.error; return; }
    ['nu-nombre','nu-correo','nu-telefono','nu-password'].forEach(id => document.getElementById(id).value='');
    showToast(`✅ Usuario ${nombre} creado`);
    await loadUsersList();
  } catch(e) { errEl.textContent='Error de conexión'; }
}
async function deleteUser(id, nombre) {
  if (!confirm(`¿Eliminar a ${nombre}?`)) return;
  try {
    const r = await fetch(`${SERVER_URL}/auth/users/${id}`, { method:'DELETE', headers:{'x-session-token':_sessionToken} });
    const d = await r.json();
    if (d.ok) { showToast('Usuario eliminado'); await loadUsersList(); }
  } catch(e) {}
}

async function resetAllLeads() {
  if (!confirm('¿Seguro que quieres borrar TODOS los leads? Esta acción no se puede deshacer.')) return;
  const toDelete = [...leads];
  leads = [];
  localStorage.setItem('er_leads', '[]');
  localStorage.setItem('er_seed_v', SEED_VERSION);
  renderKanban();
  renderSidebar();
  await Promise.all(toDelete.map(l => fsDeleteLead(l.id)));
  alert('Todos los leads han sido eliminados.');
}

function doLogout() {
  localStorage.removeItem('er_session');
  _sessionToken = null; currentUser = null;
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('app').style.display = 'none';
  document.getElementById('li-email').value = '';
  document.getElementById('li-pass').value = '';
}

// ════════════════════════════════════════════
//  SIDEBAR
// ════════════════════════════════════════════
function renderSidebar() {
  const q       = (document.getElementById('pipe-search').value || '').toLowerCase();
  const role    = currentUser?.role || 'agente';
  const allowed = new Set(getAllowedPipelines(role));
  const el      = document.getElementById('pipe-list');

  const GROUPS = [
    {
      label: '📌 Postulados',
      ids: ['postulados-meta','postulados-indeed','postulados-whatsapp-meta']
    },
    {
      label: '🎥 Webinar',
      ids: ['en-webinar'],
      webinar: true,
    },
    {
      label: '🤝 Entrevistas',
      ids: ['entrevistas-generales'],
      extraFirst: `<div class="pipe-item pipe-item-cal ${activeView==='calendario'?'active':''}" onclick="selectCalendario()">
        <span class="pipe-icon">📅</span>
        <span class="pipe-name">Calendario Entrevistas</span>
      </div>`
    }
  ];

  const _grpCollapsed = JSON.parse(localStorage.getItem('er_grp_collapsed') || '{}');

  let html = '';
  for (const group of GROUPS) {
    const grpKey = group.label.replace(/\s+/g,'_');
    const collapsed = !!_grpCollapsed[grpKey];
    const pipes = group.ids
      .map(id => PIPELINES.find(p => p.id === id))
      .filter(p => p && allowed.has(p.id) && p.nombre.toLowerCase().includes(q));
    if (!pipes.length) continue;

    const arrow = collapsed ? '▸' : '▾';
    html += `<div class="sidebar-section-hdr" onclick="toggleSidebarGroup('${grpKey}',this)">${group.label}<span class="grp-arrow">${arrow}</span></div>`;
    html += `<div class="sidebar-group-body${collapsed ? ' collapsed' : ''}">`;
    if (group.extraFirst) html += group.extraFirst;
    for (const p of pipes) {
      const count = leads.filter(l => l.pipeline_id === p.id).length;
      const active = activePipelineId === p.id && activeView === 'kanban' ? 'active' : '';
      const webinarCls = group.webinar ? 'pipe-item-webinar' : '';
      html += `<div class="pipe-item ${webinarCls} ${active}" onclick="selectPipeline('${p.id}')">
        <span class="pipe-icon">${p.icon}</span>
        <span class="pipe-name">${p.nombre}</span>
        <span class="pipe-count">${count}</span>
      </div>`;
      if (p.tabs) {
        for (const tab of p.tabs) {
          if (tab.sidebar === false) continue;
          const tabCount = leads.filter(l => l.pipeline_id === p.id && tab.etapas.some(e => e.v === l.etapa)).length;
          const tabActive = activePipelineId === p.id && activeView === 'kanban' && getPipeTab(p.id) === tab.id ? 'active' : '';
          html += `<div class="pipe-subtab ${tabActive}" onclick="selectPipelineTab('${p.id}','${tab.id}')">
            <span class="pipe-subtab-dot"></span>
            <span style="flex:1">${tab.nombre}</span>
            <span class="pipe-count" style="font-size:10px">${tabCount}</span>
          </div>`;
        }
      }
    }
    if (group.extra) html += group.extra;
    html += `</div>`;
  }
  el.innerHTML = html;
  const cfgBtn = document.getElementById('sidebar-config-btn');
  if (cfgBtn) { cfgBtn.classList.toggle('active', activeView === 'config'); }
  const wLink = document.getElementById('sidebar-webinar-link');
  if (wLink) wLink.href = webinarLink;
}

function toggleSidebarGroup(key, hdr) {
  const body = hdr.nextElementSibling;
  const _grpCollapsed = JSON.parse(localStorage.getItem('er_grp_collapsed') || '{}');
  const nowCollapsed = !body.classList.contains('collapsed');
  body.classList.toggle('collapsed', nowCollapsed);
  _grpCollapsed[key] = nowCollapsed;
  localStorage.setItem('er_grp_collapsed', JSON.stringify(_grpCollapsed));
  const arrow = hdr.querySelector('.grp-arrow');
  if (arrow) arrow.textContent = nowCollapsed ? '▸' : '▾';
}

function selectPipeline(id) {
  activePipelineId = id;
  activeView = 'kanban';
  const pipe = PIPELINES.find(p => p.id === id);
  if (pipe && !pipeTabState[id]) setPipeTab(id, getPipelineTabs(pipe)[0].id);
  document.getElementById('board-title').textContent = pipe?.nombre || id;
  document.getElementById('kanban-wrap').style.display = '';
  document.getElementById('table-view-wrap').classList.remove('active');
  document.getElementById('table-view-wrap').style.display = '';
  document.getElementById('pipeline-tabs').style.display = '';
  document.getElementById('pipeline-subtabs').style.display = '';
  document.getElementById('calendar-view').classList.remove('active');
  document.getElementById('config-view').style.display = 'none';
  document.getElementById('search-input').style.display = '';
  localStorage.setItem('er_active_pipeline', id);
  localStorage.setItem('er_active_tab', getPipeTab(id));
  const _fab = document.getElementById('phone-fab');
  if (_fab) _fab.style.display = 'flex';
  renderSidebar();
  renderKanban();
  if (typeof _updateLeadsTodayBar === 'function') _updateLeadsTodayBar();
}

function selectWebinarTab(tabId) {
  setPipeTab(activePipelineId, tabId);
  localStorage.setItem('er_active_tab', tabId);
  renderSidebar();
  renderKanban();
}

function selectPipelineTab(pipeId, tabId) {
  activePipelineId = pipeId;
  setPipeTab(pipeId, tabId);
  activeView = 'kanban';
  const pipe = PIPELINES.find(p => p.id === pipeId);
  document.getElementById('board-title').textContent = pipe?.nombre || pipeId;
  document.getElementById('kanban-wrap').style.display = '';
  document.getElementById('table-view-wrap').classList.remove('active');
  document.getElementById('table-view-wrap').style.display = '';
  document.getElementById('pipeline-tabs').style.display = '';
  document.getElementById('pipeline-subtabs').style.display = '';
  document.getElementById('calendar-view').classList.remove('active');
  document.getElementById('config-view').style.display = 'none';
  document.getElementById('search-input').style.display = '';
  localStorage.setItem('er_active_pipeline', pipeId);
  localStorage.setItem('er_active_tab', tabId);
  renderSidebar();
  renderKanban();
  if (typeof _updateLeadsTodayBar === 'function') _updateLeadsTodayBar();
}

function selectCalendario() {
  activeView = 'calendario';
  document.getElementById('board-title').textContent = 'Calendario de Entrevistas';
  document.getElementById('kanban-wrap').style.display = 'none';
  document.getElementById('table-view-wrap').classList.remove('active');
  document.getElementById('table-view-wrap').style.display = 'none';
  document.getElementById('pipeline-tabs').style.display = 'none';
  document.getElementById('pipeline-subtabs').style.display = 'none';
  document.getElementById('calendar-view').classList.add('active');
  document.getElementById('config-view').style.display = 'none';
  document.getElementById('search-input').style.display = '';
  calWeekStart = _getWeekStart(new Date());
  renderSidebar();
  renderCalendario();
}

function _getWeekStart(d) {
  const date = new Date(d);
  const day  = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1)); // Monday
  date.setHours(0,0,0,0);
  return date;
}
function calNavMonth(dir) { // kept for compat
  const d = new Date(calWeekStart);
  d.setDate(d.getDate() + dir * 7);
  calWeekStart = d;
  renderCalendario();
}
function calGoToday() { calWeekStart = _getWeekStart(new Date()); renderCalendario(); }

// ════════════════════════════════════════════
