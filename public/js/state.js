// ----- estado compartido entre módulos -----
//
// El módulo que declara cada `let` es el único que lo muta (los otros
// solo lo importan con live binding). Para variables que necesitan ser
// modificadas desde fuera del módulo "dueño", se exporta una función
// setter explícita en ese módulo, no aquí.

export const SIDEBAR_KEY = 'bici_sidebar_hidden';
export const CSRF_HEADERS = { 'x-bici-csrf': '1' };

// Tope de tamaño de upload (bytes) de imagen. Default sensato que checkAuth()
// sobreescribe con el del server (/api/me): UNA sola fuente de verdad. Es un
// objeto mutable (no se reasigna el binding), así que los módulos que lo
// importan ven el valor ya actualizado tras checkAuth.
export const MEDIA_LIMITS = { image: 10485760 };

// Sitios guardados (geofence). checkAuth() los rellena desde /api/places (mismo
// patrón mutable-no-reasignado): se vacía y se rellena en sitio, así los
// importadores ven el contenido actual por live binding. El composer los lee al
// capturar GPS para autorrellenar el nombre del sitio.
export const savedPlaces = [];

// Estado por composer (no contamina el nodo DOM con props ad-hoc).
// WeakMap permite GC automático cuando el <form> sale del DOM y ya nadie
// más lo referencia. shape: { pending: Map<localId, mediaState>, preview }
export const composerState = new WeakMap();
