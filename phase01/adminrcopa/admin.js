// ==========================================
// 1. Configuración y Variables de Estado (Globals)
// ==========================================
const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwMNTyzrulP88Riq_v2QTtJbcLIBfgS1U2jvV9GSbl_UswHqY9kX4TW02LZifkrq3VE/exec";

if (typeof temasPorPrograma === "undefined") {
  console.error("ERROR: El archivo temas.js no se cargó correctamente");
  window.temasPorPrograma = {};
}

let modoVistaActual = "general"; // Puede ser 'general' o 'defensa'
let tipoHojaActual = "TAP"; // Controla qué hoja estamos leyendo (TAP o ESP)
let modoEdicionNotas = false; // Controla si estamos en modo edición inline
let modoEdicionDocentes = false;
let mostrarNoAptos = false;
let tabla;
// Se añade la propiedad checksum al estado inicial
let estadoTabla = { totalFilas: 0, checksum: null, registros: [] };
let miGraficoFases = null;
let docentesDisponibles = [];

// ==========================================
// 2. Inicialización y Event Listeners (Setup)
// ==========================================
function toggleNoAptos() {
  mostrarNoAptos = !mostrarNoAptos;
  procesarYRenderizarTabla(estadoTabla);
}

$(document).ready(function () {
  const savedUser = localStorage.getItem("admin_user");
  const savedPass = localStorage.getItem("admin_pass");
  if (savedUser && savedPass) {
    autoIniciarSesion(savedUser, savedPass);
  }

  function manejarHabilitacionFasesEdicion() {
    const isNoApto = $("#edit_estado_fase0").val() === "NO_APTO_FASE0";
    $(
      "#edit_estado, #edit_estado_fase2, #edit_estado_fase3, #edit_estado_fase4, #edit_estado_fase5, #edit_estado_fase6",
    ).prop("disabled", isNoApto);
  }

  // 1. Vincular colorización (Incluimos los 2 nuevos selectores de validación)
  $(
    "#edit_estado_fase0, #edit_estado, #edit_estado_fase2, #edit_estado_fase3, " +
      "#edit_estado_fase4, #edit_estado_fase5, #edit_estado_fase6, " +
      "#edit_academico_f0, #edit_economico_f0",
  ).on("change", function () {
    colorizarSelect($(this).attr("id"));

    // Si cambia el Estado F0, evaluamos si bloquear los demás
    if ($(this).attr("id") === "edit_estado_fase0") {
      manejarHabilitacionFasesEdicion();
    }
  });

  // 2. Lógica de validación automática para Estado F0
  $("#edit_academico_f0, #edit_economico_f0").on("change", function () {
    const aca = $("#edit_academico_f0").val();
    const eco = $("#edit_economico_f0").val();
    const $estadoF0 = $("#edit_estado_fase0");

    if (aca === "APTO" && eco === "APTO") {
      $estadoF0.val("APTO_FASE0");
    } else if (aca === "NO_APTO" || eco === "NO_APTO") {
      $estadoF0.val("NO_APTO_FASE0");
    }

    // Actualizamos el color del Estado F0 porque su valor cambió por código
    colorizarSelect("edit_estado_fase0");
    manejarHabilitacionFasesEdicion();
  });
});

$("#edit_prog").on("change", actualizarTemas);

// Opcional: Permitir iniciar sesión presionando "Enter"
$(document).on("keypress", function (e) {
  if (e.which === 13 && $("#login-container").is(":visible")) {
    iniciarSesion();
  }
});

// ESCUCHAR CAMBIOS Y VALIDAR EN LOS INPUTS DE NOTAS (IN-LIVE)
$(document).on("input", ".input-nota", function () {
  const idPedido = $(this).data("id");
  const val = $(this).val().trim();
  const numVal = parseFloat(val);

  // 1. Validación de Rango 0-20
  if (val !== "" && (isNaN(numVal) || numVal < 0 || numVal > 20)) {
    $(this).addClass("input-nota-error");
    $(`#calc-final-${idPedido}`).html(
      '<span class="text-danger" style="font-size:0.7rem">ERROR</span>',
    );
    return;
  } else {
    $(this).removeClass("input-nota-error");
  }

  const regOriginal = estadoTabla.registros.find(
    (r) => r.id_pedido === idPedido,
  );
  const notaFinalOrig = parseFloat(regOriginal.nota_final_fase6) || 0;

  const val3 = $(`input[data-id="${idPedido}"][data-tipo="n3"]`).val();
  const val5 = $(`input[data-id="${idPedido}"][data-tipo="n5"]`).val();

  // 2. Cálculo robusto (Promedio considerando 0)
  const calcFinal = calcularPromedio(val3, val5);

  let htmlTop = notaFinalOrig > 0 ? notaFinalOrig.toFixed(2) : "-";
  let htmlBottom = "-";

  if (calcFinal !== "") {
    const calcFinalFix = parseFloat(calcFinal.toFixed(2));
    htmlBottom = calcFinalFix.toFixed(2);

    // 3. Cálculo de Varianza
    if (notaFinalOrig > 0) {
      const varianza = calcFinalFix - notaFinalOrig;
      if (varianza > 0) {
        htmlTop = `${notaFinalOrig.toFixed(2)} <span class="text-success fw-bold">(+${varianza.toFixed(2)})</span>`;
      } else if (varianza < 0) {
        htmlTop = `${notaFinalOrig.toFixed(2)} <span class="text-danger fw-bold">(${varianza.toFixed(2)})</span>`;
      } else {
        htmlTop = `${notaFinalOrig.toFixed(2)} <span class="text-muted">(=)</span>`;
      }
    }
  }

  // 4. Inyectar en los dos recuadros
  $(`#info-orig-${idPedido}`).html(htmlTop);
  $(`#calc-final-${idPedido}`).text(htmlBottom);
});

// Evento InLive para promediar
$(".calc-nota").on("input", calcularNotaFinalInLive);

$("#formEditar").submit(async (e) => {
  e.preventDefault();
  const id = $("#edit_id").val();
  const valores = {
    nombre1: $("#edit_n1").val(),
    nombre2: $("#edit_n2").val(),
    nombre3: $("#edit_n3").val(),
    correo: $("#edit_correo").val(),
    programa: $("#edit_prog").val(),
    tema: $("#edit_tema").val(),
    estado_academico_fase0: $("#edit_academico_f0").val(),
    estado_economico_fase0: $("#edit_economico_f0").val(),
    estado_fase0: $("#edit_estado_fase0").val(),
    estado: $("#edit_estado").val(),
    estado_fase2: $("#edit_estado_fase2").val(),
    estado_fase3: $("#edit_estado_fase3").val(),
    estado_fase4: $("#edit_estado_fase4").val(),
    estado_fase5: $("#edit_estado_fase5").val(),
    estado_fase6: $("#edit_estado_fase6").val(),
  };

  Swal.fire({
    title: "Guardando cambios...",
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading(),
  });

  try {
    const res = await request("editar", { id, valores });
    if (res.status === "success") {
      bootstrap.Modal.getInstance(
        document.getElementById("modalEditar"),
      ).hide();

      // ACTUALIZACIÓN IN-LIVE DEL ESTADO LOCAL
      const reg = estadoTabla.registros.find((r) => r.id_pedido === id);
      if (reg) {
        Object.assign(reg, {
          integrante_1: valores.nombre1,
          integrante_2: valores.nombre2,
          correo: valores.correo,
          programa: valores.programa,
          tema: valores.tema,
          docente: valores.docente, // NUEVO: Actualizar docente en memoria local
          estado_academico_fase0: valores.estado_academico_fase0,
          estado_economico_fase0: valores.estado_economico_fase0,
          estado_fase0: valores.estado_fase0,
          estado: valores.estado,
          estado_fase2: valores.estado_fase2,
          estado_fase3: valores.estado_fase3,
          estado_fase4: valores.estado_fase4,
          estado_fase5: valores.estado_fase5,
          estado_fase6: valores.estado_fase6,
        });
        window[`regData_${id}`] = reg;
      }

      // Repinte sin llamar a internet
      const paginaActual = tabla ? tabla.page() : 0;
      procesarYRenderizarTabla(estadoTabla);
      if (tabla) tabla.page(paginaActual).draw("page");

      Swal.fire("¡Listo!", "Registro actualizado correctamente.", "success");
    } else {
      Swal.fire("Error", res.message, "error");
    }
  } catch (error) {
    Swal.fire("Error", "No se pudo conectar", "error");
  }
});

// Enviar formulario Defensa (JVN)
$("#formEditarDefensa").submit(async (e) => {
  e.preventDefault();
  const id = $("#def_id").val();
  const valores = {
    correo: $("#def_correo").val(),
    correo_1: $("#def_correo1").val(),
    docente: $("#def_docente").val(), // NUEVO: Capturar docente seleccionado en Defensa (JVN)
    p1: $("#def_p1").val(),
    p2: $("#def_p2").val(),
    p3: $("#def_p3").val(),
    p4: $("#def_p4").val(),
    p5: $("#def_p5").val(),
    p6: $("#def_p6").val(),
    url_video: $("#def_video").val(),
    rubrica: $("#def_rubrica").val(),
    rubrica_fase6: $("#def_rubrica").val(),
    nota3:
      $("#def_nota3").val() !== "" ? parseFloat($("#def_nota3").val()) : "",
    nota5:
      $("#def_nota5").val() !== "" ? parseFloat($("#def_nota5").val()) : "",
    nota_final:
      $("#def_nota_final").val() !== ""
        ? parseFloat($("#def_nota_final").val())
        : "",
  };

  Swal.fire({
    title: "Guardando datos de defensa...",
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading(),
  });

  try {
    const res = await request("editar", { id, valores });
    if (res.status === "success") {
      bootstrap.Modal.getInstance(
        document.getElementById("modalEditarDefensa"),
      ).hide();

      // ACTUALIZACIÓN IN-LIVE DEL ESTADO LOCAL (JVN)
      const reg = estadoTabla.registros.find((r) => r.id_pedido === id);
      if (reg) {
        reg.correo = valores.correo;
        reg.correo_1 = valores.correo_1;
        reg.docente = valores.docente;
        reg.p1_fase4 = valores.p1;
        reg.p2_fase4 = valores.p2;
        reg.p3_fase4 = valores.p3;
        reg.p4_fase4 = valores.p4;
        reg.p5_fase4 = valores.p5;
        reg.p6_fase4 = valores.p6;
        reg.url_video_fase5 = valores.url_video;
        reg.rubrica_fase6 = valores.rubrica;
        reg.nota_fase3 = valores.nota3 !== "" ? parseFloat(valores.nota3) : "";
        reg.nota_fase5 = valores.nota5 !== "" ? parseFloat(valores.nota5) : "";
        reg.nota_final_fase6 =
          valores.nota_final !== "" ? parseFloat(valores.nota_final) : "";
        window[`regData_${id}`] = reg;
      }

      const paginaActual = tabla ? tabla.page() : 0;
      procesarYRenderizarTabla(estadoTabla);
      if (tabla) {
        tabla.page(paginaActual).draw("page");
      }

      Swal.fire("¡Listo!", "Datos de defensa actualizados.", "success");
    } else {
      Swal.fire("Error", res.message, "error");
    }
  } catch (error) {
    Swal.fire("Error", "No se pudo conectar al servidor", "error");
  }
});

// ==========================================
// 3. Núcleo de Comunicación (API Layer)
// ==========================================
async function request(action, data = {}) {
  // Añadimos un timestamp dinámico para evitar que la conexión muera por inactividad prolongada
  const urlAntiCache = `${WEB_APP_URL}?t=${Date.now()}`;
  const response = await fetch(urlAntiCache, {
    method: "POST",
    body: JSON.stringify({ action, data }),
    cache: "no-store", // Fuerza al navegador a no usar caché vieja
  });
  return await response.json();
}

// ==========================================
// 4. Gestión de Sesión y Acceso (Auth)
// ==========================================
async function iniciarSesion() {
  const user = $("#login_user").val().trim();
  const pass = $("#login_pass").val().trim();
  const btn = $("#btn-login");
  const btnText = btn.find(".btn-text");
  const spinner = btn.find(".spinner-border");

  if (!user || !pass) {
    return Swal.fire(
      "Atención",
      "Debes ingresar usuario y contraseña.",
      "warning",
    );
  }

  // Estado de carga en el botón
  btn.prop("disabled", true);
  btnText.addClass("d-none");
  spinner.removeClass("d-none");

  try {
    // AÑADIDO: Se envía explícitamente el rol "admin"
    const res = await request("login", { user, pass, role: "admin" });

    if (res.status === "success") {
      // Guardar credenciales para persistencia al refrescar la página
      localStorage.setItem("admin_user", user);
      localStorage.setItem("admin_pass", pass);

      $("#login-container").animate({ opacity: 0 }, 300, function () {
        $(this).removeClass("d-flex").addClass("d-none");

        // Lanzamos el Splash Screen
        $("#splash-screen").fadeIn(300);

        let bar = document.getElementById("splash-progress");
        if (bar) bar.style.width = "40%";
        let text = document.getElementById("splash-text");

        text.innerText = "Credenciales válidas. Ensamblando registros...";

        // Usamos los datos que ya vinieron empaquetados en la respuesta de login
        if (res.datos) {
          procesarYRenderizarTabla(res.datos);
        }

        bar.style.width = "100%";
        text.innerText = "¡Motores Listos!";

        setTimeout(() => {
          $("#splash-screen").fadeOut(400, () => {
            $("#main-dashboard").fadeIn(400);
          });
        }, 600);
      });
    } else {
      btn.prop("disabled", false);
      btnText.removeClass("d-none");
      spinner.addClass("d-none");
      Swal.fire("Acceso Denegado", res.message, "error");
    }
  } catch (error) {
    btn.prop("disabled", false);
    btnText.removeClass("d-none");
    spinner.addClass("d-none");
    Swal.fire("Error", "No se pudo conectar con el servidor.", "error");
  }
}

async function autoIniciarSesion(user, pass) {
  // Transición directa al splash screen
  $("#login-container").addClass("d-none");
  $("#splash-screen").show();

  let bar = document.getElementById("splash-progress");
  let text = document.getElementById("splash-text");

  bar.style.width = "30%";
  text.innerText = "Restaurando sesión. Conectando con JVN...";

  try {
    const res = await request("login", { user, pass, role: "admin" });

    if (res.status === "success") {
      bar.style.width = "70%";
      text.innerText = "Sesión validada. Descargando registros...";

      if (res.datos) {
        procesarYRenderizarTabla(res.datos);
      }

      bar.style.width = "100%";
      text.innerText = "¡Dashboard Listo!";

      setTimeout(() => {
        $("#splash-screen").fadeOut(400, () => {
          $("#main-dashboard").fadeIn(400);
        });
      }, 500);
    } else {
      // Credenciales antiguas inválidas, limpiamos y mandamos al login
      localStorage.removeItem("admin_user");
      localStorage.removeItem("admin_pass");
      $("#splash-screen").hide();
      $("#login-container").removeClass("d-none").css("opacity", 1);
      Swal.fire(
        "Sesión Expirada",
        "Tus credenciales guardadas ya no son válidas.",
        "warning",
      );
    }
  } catch (error) {
    // Error de red, regresamos al login
    $("#splash-screen").hide();
    $("#login-container").removeClass("d-none").css("opacity", 1);
    Swal.fire(
      "Error de Conexión",
      "No se pudo conectar al servidor para restaurar la sesión.",
      "error",
    );
  }
}

// Función para desloguear al usuario
function cerrarSesion() {
  localStorage.removeItem("admin_user");
  localStorage.removeItem("admin_pass");
  window.location.reload();
}

// ==========================================
// 5. Orquestación de Datos y Renderizado
// ==========================================

async function obtenerDatos(silencioso = true, forzar = false) {
  if (!silencioso) {
    Swal.fire({
      title: "Actualizando Panel...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
  }

  try {
    // Corrección: Apunta siempre a "leer", ya que Apps Script unifica la extracción de ambas hojas
    const data = await request("leer");

    // Si no se fuerza el refresco, validamos si el número de filas y el contenido (checksum) siguen idénticos
    if (
      !forzar &&
      data.totalFilas === estadoTabla.totalFilas &&
      data.checksum === estadoTabla.checksum
    ) {
      if (!silencioso) Swal.close();
      return;
    }

    procesarYRenderizarTabla(data);
    if (!silencioso) Swal.close();
  } catch (e) {
    console.error(e);
    if (!silencioso)
      Swal.fire(
        "Error de Conexión",
        "Revisa tu internet o intenta nuevamente.",
        "error",
      );
  }
}

function procesarYRenderizarTabla(data) {
  if (!data || !data.registros) return;

  if (data.reporteId) {
    const urlReporte = `https://docs.google.com/spreadsheets/d/${data.reporteId}/edit`;
    $("#link-reporte-fase6").attr("href", urlReporte);
  }

  // Guardamos los metadatos de control actualizados
  estadoTabla.totalFilas = data.totalFilas;
  estadoTabla.checksum = data.checksum;
  estadoTabla.registros = data.registros;

  // --- SOLUCIÓN: Sincronización global inmediata en window de todos los registros actualizados ---
  data.registros.forEach((reg) => {
    if (!reg.id_pedido) {
      reg.id_pedido = "ID_GENERICO_" + Math.random().toString(36).substr(2, 5);
    }
    window[`regData_${reg.id_pedido}`] = reg;
  });

  // --- NUEVO: CARGAR E INYECTAR DOCENTES DISPONIBLES EN EL SELECT ---
  if (data.docentes) {
    docentesDisponibles = data.docentes;
    const $selectDocente = $("#def_docente");
    if ($selectDocente.length) {
      $selectDocente.empty();
      $selectDocente.append(
        '<option value="">Seleccione un docente...</option>',
      );
      docentesDisponibles.forEach((docente) => {
        $selectDocente.append(`<option value="${docente}">${docente}</option>`);
      });
    }
  }

  // Filtrado de registros "NO APTO" y Tipo de Hoja (InLive)
  let registrosFiltrados = data.registros.filter((reg) => {
    if (reg.tipo_hoja !== tipoHojaActual) return false;

    const esNoApto = reg.estado_fase0 === "NO_APTO_FASE0";

    if (modoVistaActual === "defensa") {
      if (esNoApto) return false;
    }
    if (modoVistaActual === "general") {
      if (!mostrarNoAptos && esNoApto) return false;
    }
    return true;
  });

  // Renderizar las métricas KPI dinámicamente
  calcularYRenderizarMetricas(data.registros);

  let htmlHead = "";
  let htmlBody = "";

  if (modoVistaActual === "general") {
    // === VISTA GENERAL (DINÁMICA TAP / ESP) ===
    if (tipoHojaActual === "TAP") {
      htmlHead = `
      <tr>
        <th>Fecha Reg.</th>
        <th>Estudiante</th>
        <th>Programa / Tema</th>
        <th class="th-f0">F0: Estado</th>
        <th class="th-f1">F1: Doc</th>
        <th class="th-f1">F1: Estado</th>
        <th class="th-f2">F2: Docs</th>
        <th class="th-f2">F2: Estado</th>
        <th class="th-f3">F3: Docs</th>
        <th class="th-f3">F3: Estado</th>
        <th class="th-f4">F4: Doc</th>
        <th class="th-f4">F4: Estado</th>
        <th class="th-f5">F4.1: Estado</th>
        <th class="th-f6">F4.2: Nota Final</th>
        <th class="th-f6">F4.2: Estado</th>
        <th class="text-center">Acciones</th>
      </tr>`;
    } else {
      // VISTA ESP: Columnas reducidas
      htmlHead = `
      <tr>
        <th>Fecha Reg.</th>
        <th>Estudiante</th>
        <th>Programa / Tema</th>
        <th class="th-f0">F0: Estado</th>
        <th class="text-center">Acciones</th>
      </tr>`;
    }

    // CAMBIO: Iterar sobre registrosFiltrados
    registrosFiltrados.forEach((reg) => {
      // NUEVO: Determinar si la fila corresponde a un registro NO APTO
      const claseFilaNoApto =
        reg.estado_fase0 === "NO_APTO_FASE0" ? "row-no-apto" : "";

      // NUEVO: PROCESAMIENTO DE ESTADO FASE 00
      const badgeF0 = obtenerClaseEstado(reg.estado_fase0);
      const dotF0 = badgeF0 === "badge-pendiente" ? "badge-dot" : "";
      const estadoF0Limpio = reg.estado_fase0
        ? reg.estado_fase0.replace("_FASE0", "").replace(/_/g, " ")
        : "---";

      // FASE 1: Solo Pendiente lleva punto
      const badgeF1 = obtenerClaseEstado(reg.estado);
      const dotF1 = badgeF1 === "badge-pendiente" ? "badge-dot" : "";
      const estadoF1 = reg.estado || "---";

      // FASE 2: Solo Pendiente lleva punto
      const badgeF2 = obtenerClaseEstado(reg.estado_fase2);
      const dotF2 = badgeF2 === "badge-pendiente" ? "badge-dot" : "";
      const estadoF2Limpio = reg.estado_fase2
        ? reg.estado_fase2.replace("_FASE2", "")
        : "---";

      // FASE 3: Solo Pendiente lleva punto
      const badgeF3 = obtenerClaseEstado(reg.estado_fase3);
      const dotF3 = badgeF3 === "badge-pendiente" ? "badge-dot" : "";
      const estadoF3Limpio = reg.estado_fase3
        ? reg.estado_fase3.replace("_FASE3", "")
        : "---";

      // FASE 4: Solo Pendiente lleva punto
      const badgeF4 = obtenerClaseEstado(reg.estado_fase4);
      const dotF4 = badgeF4 === "badge-pendiente" ? "badge-dot" : "";
      const estadoF4Limpio = reg.estado_fase4
        ? reg.estado_fase4.replace("_FASE4", "")
        : "---";

      // FASE 5: Sin punto nunca + Limpieza de ESPERANDO_VIDEO / POR_CALIFICAR
      const badgeF5 = obtenerClaseEstado(reg.estado_fase5);
      const estadoF5Limpio = reg.estado_fase5
        ? reg.estado_fase5.replace(/_/g, " ")
        : "---";

      // FASE 6: Sin punto nunca
      const badgeF6 = obtenerClaseEstado(reg.estado_fase6);
      const estadoF6Limpio = reg.estado_fase6
        ? reg.estado_fase6.replace("_FASE6", "")
        : "---";
      const notaF6 =
        reg.nota_final_fase6 !== undefined && reg.nota_final_fase6 !== ""
          ? `<span class="fw-bold">${reg.nota_final_fase6}</span>`
          : "---";

      const btnDocF1 = reg.url_documento
        ? `<a href="${reg.url_documento}" target="_blank" class="btn-doc-f1" data-bs-toggle="tooltip" title="Abrir Documento Estructurado"><i class="fas fa-file-alt"></i></a>`
        : "-";

      // Lógica para FASE 2
      const btnPdfF2 = reg.url_pdf_fase2
        ? `<a href="${reg.url_pdf_fase2}" target="_blank" class="btn-doc-f2" data-bs-toggle="tooltip" title="Ver PDF subido (Insumo)"><i class="fas fa-file-pdf"></i></a>`
        : "";
      const btnDocF2 = reg.url_doc_fase2
        ? `<a href="${reg.url_doc_fase2}" target="_blank" class="btn-doc-f2" data-bs-toggle="tooltip" title="Abrir Prototipo Generado"><i class="fas fa-file-signature"></i></a>`
        : "";
      const arrowF2 =
        btnPdfF2 && btnDocF2
          ? `<div class="btn-arrow-separator"><i class="fas fa-angle-double-down"></i></div>`
          : "";
      const docsF2 =
        btnPdfF2 || btnDocF2
          ? `<div class="docs-vertical-container">${btnPdfF2}${arrowF2}${btnDocF2}</div>`
          : "-";

      // Lógica para FASE 3
      const btnPdfF3 = reg.url_pdf_fase3
        ? `<a href="${reg.url_pdf_fase3}" target="_blank" class="btn-doc-f3" data-bs-toggle="tooltip" title="Ver PDF subido (Insumo)"><i class="fas fa-file-pdf"></i></a>`
        : "";
      const btnDocF3 = reg.url_doc_fase3
        ? `<a href="${reg.url_doc_fase3}" target="_blank" class="btn-doc-f3" data-bs-toggle="tooltip" title="Abrir Dictamen Generado"><i class="fas fa-gavel"></i></a>`
        : "";
      const arrowF3 =
        btnPdfF3 && btnDocF3
          ? `<div class="btn-arrow-separator"><i class="fas fa-angle-double-down"></i></div>`
          : "";
      const docsF3 =
        btnPdfF3 || btnDocF3
          ? `<div class="docs-vertical-container">${btnPdfF3}${arrowF3}${btnDocF3}</div>`
          : "-";

      // Lógica para FASE 4
      const btnDocF4 = reg.url_doc_fase4
        ? `<a href="${reg.url_doc_fase4}" target="_blank" class="btn-doc-f4" data-bs-toggle="tooltip" title="Abrir Preguntas Generadas"><i class="fas fa-question-circle"></i></a>`
        : "-";

      let valorOrden = reg.f_registro;
      if (reg.f_registro) {
        const partes = reg.f_registro.split(/[\s/:]/);
        if (partes.length >= 6) {
          valorOrden = `${partes[2]}${partes[1].padStart(2, "0")}${partes[0].padStart(2, "0")}${partes[3].padStart(2, "0")}${partes[4].padStart(2, "0")}${partes[5].padStart(2, "0")}`;
        }
      }

      let btnHtmlF0 = "";
      if (reg.estado_fase0 === "APTO_FASE0") {
        btnHtmlF0 = `<button class="btn-magic-border f0-magic" onclick="reenviarEmailFase0('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar Invitación F0 - ¡LISTO!"><div class="btn-magic-content"><i class="fas fa-envelope-open-text"></i></div></button>`;
      } else {
        btnHtmlF0 = `<button class="btn btn-sm btn-f0" onclick="reenviarEmailFase0('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar Correo Invitación (F0)"><i class="fas fa-envelope-open-text"></i></button>`;
      }

      const btnEdit = `<button class="btn btn-sm btn-info text-white" onclick='prepararEdicion("${reg.id_pedido}")' data-bs-toggle="tooltip" title="Editar"><i class="fas fa-edit"></i></button>`;

      // Generar Avatar e iniciales
      const initials = obtenerIniciales(reg.integrante_1);
      const studentCellHtml = `
        <div class="d-flex align-items-center">
          <div class="avatar-circle">${initials}</div>
          <div class="student-info-cell text-start">
            <div class="student-name">${reg.integrante_1 || "Sin Nombre"}</div>
            <div class="student-email">${reg.correo || ""}</div>
          </div>
        </div>`;

      let filaCorreosHtml = "";
      if (
        reg.estado_fase0 !== "NO_APTO_FASE0" &&
        reg.modalidad_titulacion === "Trabajo de Aplicación Profesional"
      ) {
        // --- LÓGICA PARA ANIMACIÓN DE DESTELLOS EN TODAS LAS FASES ---

        // Botón F1
        let btnHtmlF1 = "";
        if (reg.estado && reg.estado.toUpperCase().includes("COMPLETADO")) {
          btnHtmlF1 = `<button class="btn-magic-border f1-magic" onclick="reenviarEmail('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar F1 - ¡LISTO!"><div class="btn-magic-content"><i class="fas fa-paper-plane"></i></div></button>`;
        } else {
          btnHtmlF1 = `<button class="btn btn-sm btn-f1" onclick="reenviarEmail('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar Correo Estructura (F1)"><i class="fas fa-paper-plane"></i></button>`;
        }

        // Botón F2
        let btnHtmlF2 = "";
        if (
          reg.estado_fase2 &&
          reg.estado_fase2.toUpperCase().includes("COMPLETADO")
        ) {
          btnHtmlF2 = `<button class="btn-magic-border f2-magic" onclick="reenviarEmailFase2('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar F2 - ¡LISTO!"><div class="btn-magic-content"><i class="fas fa-paper-plane"></i></div></button>`;
        } else {
          btnHtmlF2 = `<button class="btn btn-sm btn-f2" onclick="reenviarEmailFase2('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar Correo Prototipo (F2)"><i class="fas fa-paper-plane"></i></button>`;
        }

        // Botón F3
        let btnHtmlF3 = "";
        if (
          reg.estado_fase3 &&
          reg.estado_fase3.toUpperCase().includes("COMPLETADO")
        ) {
          btnHtmlF3 = `<button class="btn-magic-border f3-magic" onclick="reenviarEmailFase3('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar F3 - ¡LISTO!"><div class="btn-magic-content"><i class="fas fa-paper-plane"></i></div></button>`;
        } else {
          btnHtmlF3 = `<button class="btn btn-sm btn-f3" onclick="reenviarEmailFase3('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar Correo Dictamen (F3)"><i class="fas fa-paper-plane"></i></button>`;
        }

        // Botón F4
        let btnHtmlF4 = "";
        if (
          reg.estado_fase4 &&
          reg.estado_fase4.toUpperCase().includes("COMPLETADO")
        ) {
          btnHtmlF4 = `<button class="btn-magic-border f4-magic" onclick="reenviarEmailFase4('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar F4 - ¡LISTO!"><div class="btn-magic-content"><i class="fas fa-paper-plane"></i></div></button>`;
        } else {
          btnHtmlF4 = `<button class="btn btn-sm btn-f4" onclick="reenviarEmailFase4('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar Correo Preguntas (F4)"><i class="fas fa-paper-plane"></i></button>`;
        }

        // Botón F6
        let btnHtmlF6 = "";
        if (
          reg.estado_fase6 &&
          reg.estado_fase6.toUpperCase().includes("COMPLETADO")
        ) {
          btnHtmlF6 = `<button class="btn-magic-border f6-magic" onclick="reenviarEmailFase6('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar F4.2 - ¡LISTO!"><div class="btn-magic-content"><i class="fas fa-paper-plane"></i></div></button>`;
        } else {
          btnHtmlF6 = `<button class="btn btn-sm btn-f6" onclick="reenviarEmailFase6('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Enviar Correo Nota Final (F4.2)"><i class="fas fa-paper-plane"></i></button>`;
        }

        filaCorreosHtml = `
          <!-- Fila Superior: Envíos de correo -->
          <div class="btn-group shadow-sm action-group mb-1">
            ${btnHtmlF1}
            ${btnHtmlF2}
            ${btnHtmlF3}
            ${btnHtmlF4}
            ${btnHtmlF6}
          </div>
        `;
      }

      const accionesHtml = `
        <div class="d-flex flex-column align-items-center gap-1">
          ${filaCorreosHtml}
          <!-- Fila Inferior: Edición y Eliminación -->
          <div class="btn-group shadow-sm action-group">
            ${btnHtmlF0}
            ${btnEdit}
            <button class="btn btn-sm btn-danger" onclick="eliminar('${reg.id_pedido}')" data-bs-toggle="tooltip" title="Eliminar"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      `;

      let filaContenidoFases = "";
      if (tipoHojaActual === "TAP") {
        filaContenidoFases = `
          <!-- FASE 1 -->
          <td class="text-center td-f1">${btnDocF1}</td>
          <td class="text-center td-f1 border-end-phase"><span class="${badgeF1} ${dotF1}">${estadoF1}</span></td>
          <!-- FASE 2 -->
          <td class="text-center td-f2">${docsF2}</td>
          <td class="text-center td-f2 border-end-phase"><span class="${badgeF2} ${dotF2}">${estadoF2Limpio}</span></td>
          <!-- FASE 3 -->
          <td class="text-center td-f3">${docsF3}</td>
          <td class="text-center td-f3 border-end-phase"><span class="${badgeF3} ${dotF3}">${estadoF3Limpio}</span></td>
          <!-- FASE 4 -->
          <td class="text-center td-f4">${btnDocF4}</td>
          <td class="text-center td-f4 border-end-phase"><span class="${badgeF4} ${dotF4}">${estadoF4Limpio}</span></td>
          <!-- FASE 5 -->
          <td class="text-center td-f5 border-end-phase"><span class="${badgeF5}">${estadoF5Limpio}</span></td>
          <!-- FASE 6 -->
          <td class="text-center td-f6 text-success">${notaF6}</td>
          <td class="text-center td-f6 border-end-phase"><span class="${badgeF6}">${estadoF6Limpio}</span></td>
        `;
      }

      htmlBody += `<tr class="${claseFilaNoApto}">
        <td data-sort="${valorOrden}"><small>${reg.f_registro ? reg.f_registro.split(" ")[0] : "---"}</small></td>
        <td>${studentCellHtml}</td>
        <td class="border-end-phase">
          <small class="text-muted d-block mb-1" style="line-height:1.2;">${acortarTexto(reg.programa, 45)}</small>
          <span class="d-block fw-bold text-dark" style="max-width: 250px;" title="${reg.tema}">${acortarTexto(reg.tema, 45)}</span>
        </td>
        <td class="text-center td-f0 border-end-phase"><span class="${badgeF0} ${dotF0}">${estadoF0Limpio}</span></td>
        ${filaContenidoFases}
        <td class="text-center">${accionesHtml}</td>
      </tr>`;
    });
  } else {
    // === VISTA FASE DE DEFENSA ===
    const thClass =
      modoEdicionNotas || modoEdicionDocentes ? "editing-col-header" : "";

    let dictamenDefensaHeaders = "";
    let docenteHeader = "";

    if (modoEdicionNotas) {
      dictamenDefensaHeaders = `
      <th class="text-center ${thClass} th-f3">Nota Dictamen</th>
      <th class="text-center ${thClass} th-f5">Nota Defensa</th>
    `;
    }

    if (modoEdicionDocentes) {
      docenteHeader = `<th class="text-center ${thClass} th-f5">Docente Asignado</th>`;
    }

    htmlHead = `
    <tr>
      <th>M. Temporal</th>
      <th>1er Int.</th>
      <th>2do Int.</th>
      <th>Correo (1)</th>
      <th>Correo (2)</th>
      <th>Programa</th>
      <th class="text-center">Video</th>
      <th class="text-center">Preguntas</th>
      <th class="text-center">Rúbrica</th>
      ${docenteHeader}
      ${dictamenDefensaHeaders}
      <th class="text-center ${thClass} th-f6">Puntaje Final</th>
      <th class="text-center">Acciones</th>
    </tr>`;

    // CAMBIO: Iterar sobre registrosFiltrados
    registrosFiltrados.forEach((reg) => {
      let valorOrden = reg.f_registro;
      if (reg.f_registro) {
        const partes = reg.f_registro.split(/[\s/:]/);
        if (partes.length >= 6) {
          valorOrden = `${partes[2]}${partes[1].padStart(2, "0")}${partes[0].padStart(2, "0")}${partes[3].padStart(2, "0")}${partes[4].padStart(2, "0")}${partes[5].padStart(2, "0")}`;
        }
      }

      const videoEnlace = reg.url_video_fase5
        ? `<a href="${reg.url_video_fase5}" target="_blank" class="btn btn-sm btn-outline-danger" style="border-radius:6px; font-size:0.85rem; padding: 5px 14px; min-width: 50px;" data-bs-toggle="tooltip" title="Ver Video"><i class="fas fa-play"></i></a>`
        : `<span class="badge bg-secondary" style="font-size: 0.65rem; padding: 5px 10px; min-width: 50px;">N/A</span>`;

      const preguntasEnlace = reg.url_doc_fase4
        ? `<a href="${reg.url_doc_fase4}" target="_blank" class="btn btn-sm btn-outline-info" style="border-radius:6px; font-size:0.85rem; padding: 5px 14px; min-width: 50px;" data-bs-toggle="tooltip" title="Ver Preguntas"><i class="fas fa-file-alt"></i></a>`
        : `<span class="badge bg-secondary" style="font-size: 0.65rem; padding: 5px 10px; min-width: 50px;">N/A</span>`;

      const rubricaEnlace = reg.rubrica_fase6
        ? `<a href="${reg.rubrica_fase6}" target="_blank" class="btn btn-sm btn-outline-success" style="border-radius:6px; font-size:0.85rem; padding: 5px 14px; min-width: 50px;" data-bs-toggle="tooltip" title="Ver Rúbrica"><i class="fas fa-clipboard-check"></i></a>`
        : `<span class="badge bg-secondary" style="font-size: 0.65rem; padding: 5px 10px; min-width: 50px;">N/A</span>`;

      const int1 = reg.integrante_1 || "-";
      const int2 = reg.integrante_2 || "-";
      const cor1 = reg.correo || "-";
      const cor2 = reg.correo_1 || "-";
      const programa = reg.programa || "-";

      const btnEditDef = `<button class="btn btn-sm btn-primary" onclick='prepararEdicionDefensa("${reg.id_pedido}")' data-bs-toggle="tooltip" title="Editar Registro"><i class="fas fa-cogs"></i></button>`;

      let dictamenDefensaCells = "";
      let docenteCell = "";
      const tdClass =
        modoEdicionNotas || modoEdicionDocentes ? "editing-col-cell" : "";

      if (modoEdicionNotas) {
        dictamenDefensaCells = `
        <td class="text-center ${tdClass}"><input type="number" step="0.01" min="0" max="20" class="form-control form-control-sm text-center input-nota ${tdClass}" data-id="${reg.id_pedido}" data-tipo="n3" value="${reg.nota_fase3 !== undefined ? reg.nota_fase3 : ""}" style="font-size:0.75rem; padding:2px;"></td>
        <td class="text-center ${tdClass}"><input type="number" step="0.01" min="0" max="20" class="form-control form-control-sm text-center input-nota ${tdClass}" data-id="${reg.id_pedido}" data-tipo="n5" value="${reg.nota_fase5 !== undefined ? reg.nota_fase5 : ""}" style="font-size:0.75rem; padding:2px;"></td>
      `;
      }

      if (modoEdicionDocentes) {
        let options = `<option value="">Sin asignar</option>`;
        docentesDisponibles.forEach((doc) => {
          const selected = reg.docente === doc ? "selected" : "";
          options += `<option value="${doc}" ${selected}>${doc}</option>`;
        });
        docenteCell = `<td class="text-center ${tdClass}"><select class="form-select form-select-sm input-docente border border-info shadow-sm" data-id="${reg.id_pedido}" style="font-size:0.8rem; padding:4px;">${options}</select></td>`;
      }

      let celdaFinal;
      if (modoEdicionNotas) {
        const notaOriginal =
          reg.nota_final_fase6 !== undefined && reg.nota_final_fase6 !== ""
            ? reg.nota_final_fase6
            : "-";

        celdaFinal = `
        <div class="nota-final-container" id="final-box-${reg.id_pedido}" style="font-size:0.8rem;">
          <div class="nota-final-box-top" id="info-orig-${reg.id_pedido}">
             ${notaOriginal}
          </div>
          <div class="nota-final-box-bottom" id="calc-final-${reg.id_pedido}">
             -
          </div>
        </div>`;
      } else {
        celdaFinal = `<span class="fw-bold text-success" style="font-size: 0.9rem;">${reg.nota_final_fase6 !== undefined && reg.nota_final_fase6 !== "" ? reg.nota_final_fase6 : "-"}</span>`;
      }

      htmlBody += `<tr>
        <td data-sort="${valorOrden}"><small style="font-size:0.7rem;">${reg.f_registro ? reg.f_registro.split(" ")[0] : "---"}</small></td>
        <td><div style="font-size:0.7rem; line-height:1.1;">${acortarTexto(int1, 20)}</div></td>
        <td><div style="font-size:0.7rem; line-height:1.1;">${acortarTexto(int2, 20)}</div></td>
        <td><div style="font-size:0.65rem; word-break:break-all;">${acortarTexto(cor1, 25)}</div></td>
        <td><div style="font-size:0.65rem; word-break:break-all;">${acortarTexto(cor2, 25)}</div></td>
        <td><div style="font-size:0.7rem; line-height:1.1;" title="${programa}">${acortarTexto(programa, 25)}</div></td>
        <td class="text-center">${videoEnlace}</td>
        <td class="text-center">${preguntasEnlace}</td>
        <td class="text-center">${rubricaEnlace}</td>
        ${docenteCell}
        ${dictamenDefensaCells}
        <td class="text-center bg-light ${tdClass}">${celdaFinal}</td>
        <td class="text-center">${btnEditDef}</td>
      </tr>`;
    });
  }

  // Destruir DataTable previo si existe
  if (tabla) {
    tabla.clear();
    tabla.destroy();
  }

  // Inyectar HTML
  $("#tabla-head").html(htmlHead);
  $("#contenido").html(htmlBody);

  // Inicializar DataTable con configuraciones dinámicas
  let columnDefsConfig = [];
  if (modoVistaActual === "general") {
    // ... Configuración General intacta
  } else {
    // Configuración para DEFENSA
    columnDefsConfig = [
      { targets: 0, width: "60px" },
      { targets: [1, 2], width: "100px" }, // 1er y 2do Integrante
      { targets: [3, 4], width: "100px" }, // Correo (1) y Correo (2)
      { targets: 5, width: "120px" }, // Programa
      {
        targets: [6, 7, 8], // Video, Preguntas y Rúbrica
        width: "40px",
        className: "text-center",
        orderable: false,
      },
    ];

    let colIndex = 9;

    if (modoEdicionDocentes) {
      columnDefsConfig.push({
        targets: colIndex,
        width: "130px",
        className: "text-center",
      });
      colIndex++;
    }

    if (modoEdicionNotas) {
      columnDefsConfig.push({
        targets: [colIndex, colIndex + 1],
        width: "60px",
        className: "text-center",
      });
      colIndex += 2;
    }

    columnDefsConfig.push(
      { targets: colIndex, width: "70px", className: "text-center" }, // Puntaje Final
      {
        targets: colIndex + 1,
        width: "50px",
        className: "text-center",
        orderable: false,
      }, // Acciones
    );
  }

  tabla = $("#tabla").DataTable({
    order: [[0, "desc"]],
    language: {
      url: "https://cdn.datatables.net/plug-ins/1.13.4/i18n/es-ES.json",
      search: "",
      searchPlaceholder: "Buscar registro...",
    },
    pageLength: 25,
    stateSave: false,
    columnDefs: columnDefsConfig,
  });

  $(".dataTables_filter input").addClass("form-control shadow-sm");

  // ACTUALIZACIÓN DE ESTADO DEL BOTÓN NO APTOS (Ubicación estática en el Panel de Operaciones)
  const $btnNoAptos = $("#btn-toggle-no-aptos");
  if ($btnNoAptos.length) {
    if (mostrarNoAptos) {
      $btnNoAptos.removeClass("btn-outline-danger").addClass("btn-danger");
      $btnNoAptos.html('<i class="fas fa-eye me-1"></i> Ocultar NO APTOS');
    } else {
      $btnNoAptos.removeClass("btn-danger").addClass("btn-outline-danger");
      $btnNoAptos.html(
        '<i class="fas fa-eye-slash me-1"></i> Mostrar NO APTOS',
      );
    }
  }

  const tooltipTriggerList = document.querySelectorAll(
    '[data-bs-toggle="tooltip"]',
  );

  [...tooltipTriggerList].map(
    (tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl),
  );
}

// Calcular y renderizar dinámicamente las métricas del nuevo dashboard con gráficos (Fases Activas)
function calcularYRenderizarMetricas(registros) {
  if (!registros || registros.length === 0) return;

  // --- CÁLCULO DE DISTRIBUCIÓN POR FASE ACTIVA ---
  const dist = {
    f1: { total: 0, pend: 0, comp: 0, env: 0 },
    f2: { total: 0, pend: 0, comp: 0, env: 0 },
    f3: { total: 0, pend: 0, comp: 0, env: 0 },
    f4: { total: 0, pend: 0, comp: 0, env: 0 },
    f5: { total: 0, esp: 0, por: 0, cal: 0 },
    f6: { total: 0, comp: 0, env: 0 },
  };

  registros.forEach((reg) => {
    // Determinar de forma retrospectiva la fase activa más alta alcanzada
    let faseActiva = 1;
    if (reg.estado_fase6 && String(reg.estado_fase6).trim() !== "") {
      faseActiva = 6;
    } else if (reg.estado_fase5 && String(reg.estado_fase5).trim() !== "") {
      faseActiva = 5;
    } else if (reg.estado_fase4 && String(reg.estado_fase4).trim() !== "") {
      faseActiva = 4;
    } else if (reg.estado_fase3 && String(reg.estado_fase3).trim() !== "") {
      faseActiva = 3;
    } else if (reg.estado_fase2 && String(reg.estado_fase2).trim() !== "") {
      faseActiva = 2;
    } else {
      faseActiva = 1;
    }

    // Clasificación de estados para el registro según su fase activa actual
    if (faseActiva === 1) {
      dist.f1.total++;
      const est = String(reg.estado || "").toUpperCase();
      if (est.includes("PENDIENTE")) dist.f1.pend++;
      else if (est.includes("COMPLETADO")) dist.f1.comp++;
      else if (est.includes("ENVIADO")) dist.f1.env++;
      else dist.f1.pend++;
    } else if (faseActiva === 2) {
      dist.f2.total++;
      const est = String(reg.estado_fase2 || "").toUpperCase();
      if (est.includes("PENDIENTE")) dist.f2.pend++;
      else if (est.includes("COMPLETADO")) dist.f2.comp++;
      else if (est.includes("ENVIADO")) dist.f2.env++;
      else dist.f2.pend++;
    } else if (faseActiva === 3) {
      dist.f3.total++;
      const est = String(reg.estado_fase3 || "").toUpperCase();
      if (est.includes("PENDIENTE")) dist.f3.pend++;
      else if (est.includes("COMPLETADO")) dist.f3.comp++;
      else if (est.includes("ENVIADO")) dist.f3.env++;
      else dist.f3.pend++;
    } else if (faseActiva === 4) {
      dist.f4.total++;
      const est = String(reg.estado_fase4 || "").toUpperCase();
      if (est.includes("PENDIENTE")) dist.f4.pend++;
      else if (est.includes("COMPLETADO")) dist.f4.comp++;
      else if (est.includes("ENVIADO")) dist.f4.env++;
      else dist.f4.pend++;
    } else if (faseActiva === 5) {
      dist.f5.total++;
      const est = String(reg.estado_fase5 || "").toUpperCase();
      if (est.includes("ESPERANDO")) dist.f5.esp++;
      else if (est.includes("POR_CALIFICAR") || est.includes("PROCESANDO"))
        dist.f5.por++;
      else if (est.includes("CALIFICADO") || est.includes("COMPLETADO"))
        dist.f5.cal++;
      else dist.f5.esp++;
    } else if (faseActiva === 6) {
      dist.f6.total++;
      const est = String(reg.estado_fase6 || "").toUpperCase();
      if (est.includes("COMPLETADO")) dist.f6.comp++;
      else if (est.includes("ENVIADO")) dist.f6.env++;
      else dist.f6.comp++;
    }
  });

  // Renderizar valores de texto numéricos
  $("#dist-f1-total").text(dist.f1.total);
  $("#dist-f1-pend").text(dist.f1.pend);
  $("#dist-f1-comp").text(dist.f1.comp);
  $("#dist-f1-env").text(dist.f1.env);

  $("#dist-f2-total").text(dist.f2.total);
  $("#dist-f2-pend").text(dist.f2.pend);
  $("#dist-f2-comp").text(dist.f2.comp);
  $("#dist-f2-env").text(dist.f2.env);

  $("#dist-f3-total").text(dist.f3.total);
  $("#dist-f3-pend").text(dist.f3.pend);
  $("#dist-f3-comp").text(dist.f3.comp);
  $("#dist-f3-env").text(dist.f3.env);

  $("#dist-f4-total").text(dist.f4.total);
  $("#dist-f4-pend").text(dist.f4.pend);
  $("#dist-f4-comp").text(dist.f4.comp);
  $("#dist-f4-env").text(dist.f4.env);

  $("#dist-f5-total").text(dist.f5.total);
  $("#dist-f5-esp").text(dist.f5.esp);
  $("#dist-f5-por").text(dist.f5.por);
  $("#dist-f5-cal").text(dist.f5.cal);

  $("#dist-f6-total").text(dist.f6.total);
  $("#dist-f6-comp").text(dist.f6.comp);
  $("#dist-f6-env").text(dist.f6.env);

  // Helper local para setear de manera segura los anchos porcentuales de las mini-barras
  const setBarWidths = (total, barIds, counts) => {
    barIds.forEach((id, idx) => {
      const count = counts[idx] || 0;
      const pct = total > 0 ? (count / total) * 100 : 0;
      $(`#${id}`).css("width", `${pct}%`);
    });
  };

  setBarWidths(
    dist.f1.total,
    ["dist-f1-bar-pend", "dist-f1-bar-comp", "dist-f1-bar-env"],
    [dist.f1.pend, dist.f1.comp, dist.f1.env],
  );
  setBarWidths(
    dist.f2.total,
    ["dist-f2-bar-pend", "dist-f2-bar-comp", "dist-f2-bar-env"],
    [dist.f2.pend, dist.f2.comp, dist.f2.env],
  );
  setBarWidths(
    dist.f3.total,
    ["dist-f3-bar-pend", "dist-f3-bar-comp", "dist-f3-bar-env"],
    [dist.f3.pend, dist.f3.comp, dist.f3.env],
  );
  setBarWidths(
    dist.f4.total,
    ["dist-f4-bar-pend", "dist-f4-bar-comp", "dist-f4-bar-env"],
    [dist.f4.pend, dist.f4.comp, dist.f4.env],
  );
  setBarWidths(
    dist.f5.total,
    ["dist-f5-bar-esp", "dist-f5-bar-por", "dist-f5-bar-cal"],
    [dist.f5.esp, dist.f5.por, dist.f5.cal],
  );
  setBarWidths(
    dist.f6.total,
    ["dist-f6-bar-comp", "dist-f6-bar-env"],
    [dist.f6.comp, dist.f6.env],
  );

  // --- INTEGRACIÓN Y ACTUALIZACIÓN DINÁMICA DE CHART.JS ---
  const dataChart = [
    dist.f1.total,
    dist.f2.total,
    dist.f3.total,
    dist.f4.total,
    dist.f5.total,
    dist.f6.total,
  ];

  if (miGraficoFases) {
    miGraficoFases.data.datasets[0].data = dataChart;
    miGraficoFases.update();
  } else {
    const canvasElement = document.getElementById("chartFasesActivas");
    if (canvasElement) {
      const ctx = canvasElement.getContext("2d");
      miGraficoFases = new Chart(ctx, {
        type: "bar",
        data: {
          labels: [
            "F1: Base",
            "F2: Prototipo",
            "F3: Dictamen",
            "F4: Preguntas",
            "F4.1: Defensa",
            "F4.2: Cierre",
          ],
          datasets: [
            {
              label: "Registros Activos",
              data: dataChart,
              backgroundColor: [
                "#94a3b8", // F1 Gris Niebla oscuro (apoyo)
                "#64748b", // F2 Slate (apoyo)
                "#002D56", // F3 Azul Empresa
                "#0A1F44", // F4 Azul Prestigio
                "#F15A24", // F5 Naranja Instituto
                "#FF8200", // F6 Naranja Energía
              ],
              borderColor: [
                "#475569",
                "#334155",
                "#001a33",
                "#050f22",
                "#c43e0e",
                "#cc6900",
              ],
              borderWidth: 1,
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              backgroundColor: "#0A1F44", // Azul Prestigio
              titleFont: { family: "Outfit", weight: "bold" },
              bodyFont: { family: "Plus Jakarta Sans" },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                stepSize: 1,
                font: {
                  family: "Plus Jakarta Sans",
                  size: 11,
                },
              },
              grid: {
                color: "#F4F4F4",
              },
            },
            x: {
              ticks: {
                font: {
                  family: "Outfit",
                  size: 11,
                  weight: "600",
                },
              },
              grid: {
                display: false,
              },
            },
          },
        },
      });
    }
  }
}

// ==========================================
// 6. Helpers de Formato y UI (Utilidades)
// ==========================================
// Helper para extraer iniciales de un nombre
function obtenerIniciales(nombre) {
  if (!nombre) return "ST";
  const partes = nombre.trim().split(/\s+/);
  if (partes.length >= 2) {
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }
  return partes[0][0].toUpperCase();
}

// Lógica de asignación de color al Badge basado en el avance de estados con los colores de JVN
function obtenerClaseEstado(estado) {
  if (!estado || estado.trim() === "" || estado === "---") return "bg-vacio";

  const est = estado.toUpperCase();

  if (
    est.includes("PENDIENTE") ||
    est.includes("ESPERANDO") ||
    est.includes("EVALUANDO")
  ) {
    return "badge-pendiente";
  }
  if (est.includes("PROCESANDO") || est.includes("POR_CALIFICAR")) {
    return "badge-procesando";
  }
  if (
    est.includes("COMPLETADO") ||
    est === "CALIFICADO" ||
    (est.includes("APTO") && !est.includes("NO_APTO"))
  ) {
    return "badge-completado";
  }
  if (est.includes("NO_APTO")) {
    return "badge-no-apto";
  }
  if (est.includes("ENVIADO")) {
    return "badge-enviado";
  }

  return "bg-vacio";
}

// Mantener fallback para la función getBadgeClass si se requiere en otros procesos
function getBadgeClass(estado) {
  return obtenerClaseEstado(estado);
}

function getBadgeClassF2(estado) {
  return getBadgeClass(estado);
}

function getBadgeClassF3(estado) {
  return getBadgeClass(estado);
}

function getBadgeClassF4(estado) {
  return getBadgeClass(estado);
}

// Colorización dinámica del texto de los desplegables de "Control de Fases" según el estado (JVN Palette)
function colorizarSelect(selectId) {
  const $select = $(`#${selectId}`);
  const val = $select.val() || "";
  const est = val.toUpperCase();

  // Definición de colores según la identidad visual del sistema
  let color = "#475569"; // Gris Neutro
  let fontWeight = "700"; // Negrita para estados activos

  if (est.includes("PENDIENTE") || est.includes("ESPERANDO") || est.includes("EVALUANDO")) {
    color = "#002D56"; // Azul Empresa
  } else if (est.includes("PROCESANDO") || est.includes("POR_CALIFICAR")) {
    color = "#F15A24"; // Naranja Instituto
  } else if (est.includes("COMPLETADO") || est === "CALIFICADO" || (est.includes("APTO") && !est.includes("NO_APTO"))) {
    color = "#059669"; // Éxito (Verde corporativo estándar)
  } else if (est.includes("NO_APTO")) {
    color = "#b91c1c"; // Peligro (Rojo)
  } else if (est.includes("ENVIADO")) {
    color = "#0A1F44"; // Azul Prestigio
  } else {
    fontWeight = "normal"; // Para estados vacíos o "SIN INICIAR"
    color = "#94a3b8";
  }

  $select.css({
    color: color,
    "font-weight": fontWeight,
  });
}

function acortarTexto(texto, maxLength = 60) {
  if (!texto) return "---";
  if (texto.length <= maxLength) return texto;
  return texto.substring(0, maxLength) + "...";
}

// ==========================================
// 7. Control de Vistas y Modos de Edición
// ==========================================
function toggleVistaDefensa() {
  const btn = $("#btn-toggle-vista");
  const panelOps = $("#panel-operaciones");
  const panelOpsDefensa = $("#panel-operaciones-defensa");

  if (modoVistaActual === "general") {
    modoVistaActual = "defensa";
    modoEdicionNotas = false;
    modoEdicionDocentes = false; // NUEVO
    btn.html('<i class="fas fa-table"></i> Vista General');
    btn.removeClass("btn-outline-info").addClass("btn-outline-primary");
    panelOps.hide();
    panelOpsDefensa.show(); // Muestra el panel de defensa
  } else {
    modoVistaActual = "general";
    modoEdicionNotas = false;
    modoEdicionDocentes = false; // NUEVO
    btn.html('<i class="fas fa-video"></i> Vista Defensa de Notas');
    btn.removeClass("btn-outline-primary").addClass("btn-outline-info");
    panelOps.show();
    panelOpsDefensa.hide(); // Oculta el panel de defensa
  }

  // Asegurar el reset de botones de edición
  $("#btn-editar-notas")
    .html('<i class="fas fa-edit"></i> Editar Notas')
    .removeClass("btn-success")
    .addClass("btn-warning");
  $("#btn-cancelar-notas").addClass("d-none");

  // NUEVO: Asegurar el reset de botones de edición docentes
  $("#btn-editar-docentes")
    .html('<i class="fas fa-chalkboard-teacher me-1"></i> Asignar Docentes')
    .removeClass("btn-success")
    .addClass("btn-info");
  $("#btn-cancelar-docentes").addClass("d-none");

  procesarYRenderizarTabla(estadoTabla);
}

function toggleVistaESP() {
  const btnESP = $("#btn-toggle-esp-view");
  const btnDefensa = $("#btn-toggle-vista");

  if (tipoHojaActual === "TAP") {
    tipoHojaActual = "ESP";
    btnESP.html('<i class="fas fa-briefcase me-2"></i> Cambiar a Vista TAP');
    btnESP.removeClass("btn-outline-warning").addClass("btn-outline-success");

    if (modoVistaActual === "defensa") {
      modoVistaActual = "general";
      $("#btn-toggle-vista").html(
        '<i class="fas fa-video me-1"></i> Vista Defensa de Notas',
      );
      $("#panel-operaciones").show();
      $("#panel-operaciones-defensa").hide();
    }
    btnDefensa.fadeOut(200); // El botón de defensa desaparece suavemente en ESP
  } else {
    tipoHojaActual = "TAP";
    btnESP.html(
      '<i class="fas fa-file-signature me-2"></i> Cambiar a Vista ESP',
    );
    btnESP.removeClass("btn-outline-success").addClass("btn-outline-warning");
    btnDefensa.fadeIn(200);
  }

  // Refrescar tabla localmente (InLive)
  procesarYRenderizarTabla(estadoTabla);
}

// NUEVA FUNCIÓN PARA ALTERNAR MODO EDICIÓN
function toggleEdicionNotas() {
  const btnNotas = $("#btn-editar-notas");
  const btnCancelar = $("#btn-cancelar-notas");

  if (!modoEdicionNotas) {
    modoEdicionNotas = true;
    btnNotas
      .html('<i class="fas fa-save"></i> Guardar Notas')
      .removeClass("btn-warning")
      .addClass("btn-success");
    btnCancelar.removeClass("d-none");
    procesarYRenderizarTabla(estadoTabla); // Re-renderizar con los inputs
  } else {
    guardarNotasEnVivo(); // Si ya estaba activo, funciona como Guardar
  }
}

function cancelarEdicionNotas() {
  modoEdicionNotas = false;
  $("#btn-editar-notas")
    .html('<i class="fas fa-edit"></i> Editar Notas')
    .removeClass("btn-success")
    .addClass("btn-warning");
  $("#btn-cancelar-notas").addClass("d-none");
  procesarYRenderizarTabla(estadoTabla); // Volver al modo lectura sin guardar cambios
}

// NUEVAS FUNCIONES PARA MODO EDICIÓN DOCENTES
function toggleEdicionDocentes() {
  const btnDocentes = $("#btn-editar-docentes");
  const btnCancelar = $("#btn-cancelar-docentes");

  if (!modoEdicionDocentes) {
    modoEdicionDocentes = true;
    if (modoEdicionNotas) cancelarEdicionNotas(); // Evitar superposición

    btnDocentes
      .html('<i class="fas fa-save me-1"></i> Guardar Docentes')
      .removeClass("btn-info")
      .addClass("btn-success");
    btnCancelar.removeClass("d-none");
    procesarYRenderizarTabla(estadoTabla);
  } else {
    guardarDocentesEnVivo();
  }
}

function cancelarEdicionDocentes() {
  modoEdicionDocentes = false;
  $("#btn-editar-docentes")
    .html('<i class="fas fa-chalkboard-teacher me-1"></i> Asignar Docentes')
    .removeClass("btn-success")
    .addClass("btn-info");
  $("#btn-cancelar-docentes").addClass("d-none");
  procesarYRenderizarTabla(estadoTabla);
}

async function guardarDocentesEnVivo() {
  const listaCambios = [];

  $(".input-docente").each(function () {
    const id = $(this).data("id");
    const docenteVal = $(this).val();

    const regOriginal = estadoTabla.registros.find((r) => r.id_pedido === id);
    const docenteOriginal = regOriginal.docente || "";

    if (docenteVal !== docenteOriginal) {
      listaCambios.push({ id: id, docente: docenteVal });
    }
  });

  if (listaCambios.length === 0) {
    cancelarEdicionDocentes();
    return;
  }

  Swal.fire({
    title: "Guardando asignaciones...",
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading(),
  });

  try {
    const res = await request("editarDocentesMasivo", listaCambios);
    if (res.status === "success") {
      modoEdicionDocentes = false;
      $("#btn-editar-docentes")
        .html('<i class="fas fa-chalkboard-teacher me-1"></i> Asignar Docentes')
        .removeClass("btn-success")
        .addClass("btn-info");
      $("#btn-cancelar-docentes").addClass("d-none");
      await obtenerDatos(true, true);
      Swal.fire(
        "¡Éxito!",
        "Se han asignado los docentes correctamente.",
        "success",
      );
    } else {
      Swal.fire("Error", res.message, "error");
    }
  } catch (error) {
    Swal.fire("Error", "No se pudo conectar al servidor", "error");
  }
}

// ==========================================
// 8. Acciones de Fila (CRUD Individual)
// ==========================================
function prepararEdicion(idPedido) {
  const reg = window[`regData_${idPedido}`];
  if (!reg) return;

  $("#edit_id").val(reg.id_pedido);
  $("#edit_n1").val(reg.integrante_1);
  $("#edit_n2").val(reg.integrante_2);
  $("#edit_correo").val(reg.correo);
  $("#edit_prog").val(reg.programa);
  $("#edit_academico_f0").val(reg.estado_academico_fase0 || "");
  $("#edit_economico_f0").val(reg.estado_economico_fase0 || "");
  $("#edit_estado_fase0").val(reg.estado_fase0 || "");
  $("#edit_estado").val(reg.estado || "");
  $("#edit_estado_fase2").val(reg.estado_fase2 || "");
  $("#edit_estado_fase3").val(reg.estado_fase3 || "");
  $("#edit_estado_fase4").val(reg.estado_fase4 || "");
  $("#edit_estado_fase5").val(reg.estado_fase5 || "");
  $("#edit_estado_fase6").val(reg.estado_fase6 || "");

  // Colorizar inicialmente cada select
  colorizarSelect("edit_estado_fase0");
  colorizarSelect("edit_estado");
  colorizarSelect("edit_estado_fase2");
  colorizarSelect("edit_estado_fase3");
  colorizarSelect("edit_estado_fase4");
  colorizarSelect("edit_estado_fase5"); // NUEVO
  colorizarSelect("edit_estado_fase6"); // NUEVO

  actualizarTemas();
  const isNoApto = reg.estado_fase0 === "NO_APTO_FASE0";
  $(
    "#edit_estado, #edit_estado_fase2, #edit_estado_fase3, #edit_estado_fase4, #edit_estado_fase5, #edit_estado_fase6",
  ).prop("disabled", isNoApto);

  setTimeout(() => {
    $("#edit_tema").val(reg.tema);
  }, 100);

  new bootstrap.Modal("#modalEditar").show();
}

function prepararEdicionDefensa(idPedido) {
  const reg = window[`regData_${idPedido}`];
  if (!reg) return;

  $("#def_id").val(reg.id_pedido);
  $("#def_correo").val(reg.correo);
  $("#def_correo1").val(reg.correo_1 || "");
  $("#def_docente").val(reg.docente || "");
  $("#def_p1").val(reg.p1_fase4 || "");
  $("#def_p2").val(reg.p2_fase4 || "");
  $("#def_p3").val(reg.p3_fase4 || "");
  $("#def_p4").val(reg.p4_fase4 || "");
  $("#def_p5").val(reg.p5_fase4 || "");
  $("#def_p6").val(reg.p6_fase4 || "");
  $("#def_video").val(reg.url_video_fase5 || "");
  $("#def_rubrica").val(reg.rubrica_fase6 || ""); // Asignación del enlace de la rúbrica
  $("#def_nota3").val(reg.nota_fase3 || "");
  $("#def_nota5").val(reg.nota_fase5 || "");

  calcularNotaFinalInLive(); // Calcula la nota actual

  new bootstrap.Modal("#modalEditarDefensa").show();
}

async function eliminar(id) {
  const confirm = await Swal.fire({
    title: "¿Eliminar registro?",
    text: "Esta acción borrará permanentemente el registro del sistema",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#d33",
    cancelButtonColor: "#3085d6",
    confirmButtonText: "Sí, eliminar",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Eliminando...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await request("eliminar", { id });
      if (res.status === "success") {
        // Actualización local para remover fila
        estadoTabla.registros = estadoTabla.registros.filter(
          (r) => r.id_pedido !== id,
        );
        estadoTabla.totalFilas--;
        const paginaActual = tabla ? tabla.page() : 0;
        procesarYRenderizarTabla(estadoTabla);
        if (tabla) tabla.page(paginaActual).draw("page");

        Swal.fire("Eliminado", res.message, "success");
      } else {
        Swal.fire("Error", res.message || "Error al eliminar", "error");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo conectar con el servidor", "error");
    }
  }
}

function actualizarTemas() {
  const prog = $("#edit_prog").val();
  const temas = temasPorPrograma[prog] || [];
  const $datalist = $("#temas-list");

  $datalist.empty();
  temas.forEach((t) => {
    $datalist.append(`<option value="${t}"></option>`);
  });
}

// ==========================================
// 9. Lógica de Calificaciones (Cálculos In-Live)
// ==========================================

function calcularNotaFinalInLive() {
  const val3 = $("#def_nota3").val();
  const val5 = $("#def_nota5").val();

  // Usar exactamente la misma lógica robusta [1]
  const final = calcularPromedio(val3, val5);

  $("#def_nota_final").val(final !== "" ? final.toFixed(2) : "");
}

function calcularPromedio(val3, val5) {
  const str3 =
    val3 !== null && val3 !== undefined ? val3.toString().trim() : "";
  const str5 =
    val5 !== null && val5 !== undefined ? val5.toString().trim() : "";

  if (str3 === "" && str5 === "") return "";

  const n3 = parseFloat(str3);
  const n5 = parseFloat(str5);

  // Si uno de los campos está vacío, el promedio toma el valor entero del otro (no se divide entre 2)
  if (str3 !== "" && str5 === "") return isNaN(n3) ? "" : n3;
  if (str3 === "" && str5 !== "") return isNaN(n5) ? "" : n5;

  // Si ambos campos están llenos (incluyendo el valor '0'), se promedian rigurosamente
  if (!isNaN(n3) && !isNaN(n5)) {
    return (n3 + n5) / 2;
  }
  return "";
}

async function guardarNotasEnVivo() {
  const listaCambios = [];
  let hayErrorDeRango = false;

  $(".input-nota[data-tipo='n3']").each(function () {
    const id = $(this).data("id");
    const val3 = $(this).val().trim();
    const val5 = $(`input[data-id="${id}"][data-tipo="n5"]`).val().trim();

    const n3 = parseFloat(val3);
    const n5 = parseFloat(val5);

    // Validación estricta actualizada a la escala 0-20
    if (val3 !== "" && (isNaN(n3) || n3 < 0 || n3 > 20)) hayErrorDeRango = true;
    if (val5 !== "" && (isNaN(n5) || n5 < 0 || n5 > 20)) hayErrorDeRango = true;

    const calcFinal = calcularPromedio(val3, val5);

    if (val3 !== "" || val5 !== "") {
      listaCambios.push({
        id: id,
        nota3: val3 !== "" ? parseFloat(n3.toFixed(2)) : "",
        nota5: val5 !== "" ? parseFloat(n5.toFixed(2)) : "",
        nota_final: calcFinal !== "" ? parseFloat(calcFinal.toFixed(2)) : "",
      });
    }
  });

  if (hayErrorDeRango) {
    Swal.fire(
      "Error de Validación",
      "Por favor corrige las notas. El rango permitido es de 0 a 20.",
      "error",
    );
    return;
  }

  if (listaCambios.length === 0) {
    cancelarEdicionNotas();
    return;
  }

  Swal.fire({
    title: "Guardando notas...",
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading(),
  });

  try {
    const res = await request("editarNotasMasivo", listaCambios);
    if (res.status === "success") {
      modoEdicionNotas = false;
      $("#btn-editar-notas")
        .html('<i class="fas fa-edit"></i> Editar Notas')
        .removeClass("btn-success")
        .addClass("btn-warning");
      $("#btn-cancelar-notas").addClass("d-none");
      await obtenerDatos(true, true);
      Swal.fire(
        "¡Éxito!",
        "Todas las notas se han guardado y promediado correctamente.",
        "success",
      );
    } else {
      Swal.fire("Error", res.message, "error");
    }
  } catch (error) {
    Swal.fire("Error", "No se pudo conectar al servidor", "error");
  }
}

// ==========================================
// 10. Acciones de Fase y Comunicaciones (F1 - F6)
// ==========================================
async function reenviarEmailFase0(id) {
  const reg = window[`regData_${id}`];
  if (!reg) return;

  // Validación estricta de estado APTO
  if (reg.estado_fase0 !== "APTO_FASE0") {
    return Swal.fire(
      "Acción Bloqueada",
      "El correo de invitación (F0) sólo se puede enviar a estudiantes con estado 'APTO' en la Fase 00.",
      "warning",
    );
  }

  const nombreEstudiante = reg.integrante_1 || "el estudiante";
  const confirm = await Swal.fire({
    title: "¿Enviar invitación de Fase 00?",
    text: `Se enviará el correo de invitación a ${nombreEstudiante}.`,
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#F15A24",
    confirmButtonText: "Sí, enviar",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Enviando invitación...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await request("enviarEmailFase0", { id });
      if (res.status === "success") {
        actualizarEstadoLocal([id], 0, "ENVIADO_FASE0");
        Swal.fire("¡Enviado!", res.message, "success");
      } else {
        Swal.fire("Atención", res.message, "warning");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo conectar con el servidor", "error");
    }
  }
}

async function reenviarEmail(id) {
  const reg = window[`regData_${id}`];
  const nombreEstudiante = reg ? reg.integrante_1 : "el estudiante";
  const confirm = await Swal.fire({
    title: "¿Enviar correo?",
    text: `Se enviará el enlace del documento Fase 01 a \n ${nombreEstudiante}.`,
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#F15A24", // Morado JVN
    confirmButtonText: "Sí, enviar",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Enviando email...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await request("enviarEmail", { id });
      if (res.status === "success") {
        actualizarEstadoLocal([id], 1, "ENVIADO");
        Swal.fire("¡Enviado!", res.message, "success");
      } else {
        Swal.fire("Atención", res.message, "warning");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo conectar con el servidor", "error");
    }
  }
}

async function enviarTodosFase0() {
  if (!estadoTabla.registros) return;

  // Filtrado de candidatos únicamente APTOS en Fase 00
  const candidatos = estadoTabla.registros.filter(
    (reg) => reg.estado_fase0 === "APTO_FASE0",
  );

  if (candidatos.length === 0) {
    return Swal.fire(
      "Sin Candidatos",
      "No hay registros con estado 'APTO' en la Fase 00 listos para recibir invitación.",
      "info",
    );
  }

  const listaCorreos = candidatos.map((c) => `<li>${c.correo}</li>`).join("");
  const htmlLista = `
    <p>Se enviarán correos de invitación a los <b>${candidatos.length}</b> estudiantes APTOS (TAP y ESP):</p>
    <div style="max-height: 150px; overflow-y: auto; text-align: left; background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px solid #dee2e6;">
      <ul style="margin:0; padding-left: 20px; font-size: 0.9rem;">${listaCorreos}</ul>
    </div>`;

  const confirm = await Swal.fire({
    title: "¿Enviar invitaciones masivas (F0)?",
    html: htmlLista,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#F15A24",
    confirmButtonText: "Sí, enviar a todos",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Procesando envíos...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await request("enviarMasivoFase0");
      if (res.status === "success") {
        const idsActualizados = candidatos.map((c) => c.id_pedido);
        // 1. Actualización InLive inmediata (Percepción de velocidad)
        actualizarEstadoLocal(idsActualizados, 0, "ENVIADO_FASE0");

        // 2. Sincronización silenciosa de fondo (Seguridad de datos)
        // Esto corrige cualquier registro que no se haya pintado bien
        await obtenerDatos(true, true);

        Swal.fire("Proceso terminado", res.message, "success");
      } else {
        Swal.fire("Error", res.message, "error");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo completar la operación", "error");
    }
  }
}

async function enviarTodosFase1() {
  if (!estadoTabla.registros) return;
  const candidatos = estadoTabla.registros.filter(
    (reg) =>
      reg.tipo_hoja === tipoHojaActual &&
      reg.estado_fase0 !== "NO_APTO_FASE0" &&
      reg.estado &&
      reg.estado.toUpperCase() === "COMPLETADO" &&
      reg.url_documento,
  );

  if (candidatos.length === 0) {
    return Swal.fire(
      "Atención",
      "No hay registros listos para enviar en Fase 1.",
      "info",
    );
  }

  const listaCorreos = candidatos.map((c) => `<li>${c.correo}</li>`).join("");
  const htmlLista = `<p>Se enviarán <b>${candidatos.length}</b> emails:</p><div style="max-height: 150px; overflow-y: auto; text-align: left; background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px solid #dee2e6;"><ul style="margin:0; padding-left: 20px; font-size: 0.9rem;">${listaCorreos}</ul></div>`;

  const confirm = await Swal.fire({
    title: "¿Enviar correos en masa (Fase 1)?",
    html: htmlLista,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#F15A24", // Morado JVN
    confirmButtonText: "Sí, enviar a todos",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Procesando envíos...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await request("enviarMasivo");
      if (res.status === "success") {
        const idsActualizados = candidatos.map((c) => c.id_pedido);
        actualizarEstadoLocal(idsActualizados, 1, "ENVIADO");
        await obtenerDatos(true, true);
        Swal.fire("Proceso terminado", res.message, "success");
      } else {
        Swal.fire("Error", res.message, "error");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo completar la operación", "error");
    }
  }
}

async function reenviarEmailFase2(id) {
  const reg = window[`regData_${id}`];
  const nombreEstudiante = reg ? reg.integrante_1 : "el estudiante";
  const confirm = await Swal.fire({
    title: "¿Enviar correo con el Prototipo?",
    text: `Se enviará el enlace del documento Fase 02 (Prototipo) a \n ${nombreEstudiante}.`,
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#FF8200", // Violeta Real
    confirmButtonText: "Sí, enviar prototipo",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Enviando email...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await request("enviarEmailFase2", { id });
      if (res.status === "success") {
        actualizarEstadoLocal([id], 2, "ENVIADO_FASE2");
        Swal.fire("¡Enviado!", res.message, "success");
      } else {
        Swal.fire("Atención", res.message, "warning");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo conectar con el servidor", "error");
    }
  }
}

async function enviarTodosFase2() {
  if (!estadoTabla.registros) return;
  const candidatos = estadoTabla.registros.filter(
    (reg) =>
      reg.tipo_hoja === tipoHojaActual &&
      reg.estado_fase0 !== "NO_APTO_FASE0" &&
      reg.estado_fase2 &&
      reg.estado_fase2.toUpperCase().includes("COMPLETADO") &&
      reg.url_doc_fase2,
  );

  if (candidatos.length === 0) {
    return Swal.fire("Atención", "No hay prototipos listos en Fase 2.", "info");
  }

  const listaCorreos = candidatos.map((c) => `<li>${c.correo}</li>`).join("");
  const htmlLista = `<p>Se enviarán <b>${candidatos.length}</b> prototipos:</p><div style="max-height: 150px; overflow-y: auto; text-align: left; background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px solid #dee2e6;"><ul style="margin:0; padding-left: 20px; font-size: 0.9rem;">${listaCorreos}</ul></div>`;

  const confirm = await Swal.fire({
    title: "¿Enviar correos en masa (Fase 2)?",
    html: htmlLista,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#FF8200", // Violeta Real
    confirmButtonText: "Sí, enviar a todos",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Procesando envíos...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await request("enviarMasivoFase2");
      if (res.status === "success") {
        const idsActualizados = candidatos.map((c) => c.id_pedido);
        actualizarEstadoLocal(idsActualizados, 2, "ENVIADO_FASE2");
        await obtenerDatos(true, true);
        Swal.fire("Proceso terminado", res.message, "success");
      } else {
        Swal.fire("Error", res.message, "error");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo completar la operación", "error");
    }
  }
}

async function reenviarEmailFase3(id) {
  const reg = window[`regData_${id}`];
  const nombreEstudiante = reg ? reg.integrante_1 : "el estudiante";
  const confirm = await Swal.fire({
    title: "¿Enviar correo con el Dictamen?",
    text: `Se enviará el enlace del documento Fase 03 (Dictamen) a \n ${nombreEstudiante}.`,
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#002D56", // Púrpura Medianoche
    confirmButtonText: "Sí, enviar dictamen",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({ title: "Enviando...", didOpen: () => Swal.showLoading() });
    try {
      const res = await request("enviarEmailFase3", { id });
      if (res.status === "success") {
        actualizarEstadoLocal([id], 3, "ENVIADO_FASE3");
        Swal.fire("¡Enviado!", res.message, "success");
      } else {
        Swal.fire("Error", res.message, "warning");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo conectar con el servidor", "error");
    }
  }
}

async function enviarTodosFase3() {
  if (!estadoTabla.registros) return;
  const candidatos = estadoTabla.registros.filter(
    (reg) =>
      reg.tipo_hoja === tipoHojaActual &&
      reg.estado_fase0 !== "NO_APTO_FASE0" &&
      reg.estado_fase3 &&
      reg.estado_fase3.toUpperCase().includes("COMPLETADO") &&
      reg.url_doc_fase3,
  );

  if (candidatos.length === 0) {
    return Swal.fire("Atención", "No hay dictámenes listos.", "info");
  }

  const listaCorreos = candidatos.map((c) => `<li>${c.correo}</li>`).join("");
  const htmlLista = `<p>Se enviarán <b>${candidatos.length}</b> dictámenes:</p><div style="max-height: 150px; overflow-y: auto; text-align: left; background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px solid #dee2e6;"><ul style="margin:0; padding-left: 20px; font-size: 0.9rem;">${listaCorreos}</ul></div>`;

  const confirm = await Swal.fire({
    title: "¿Enviar correos en masa (Fase 3)?",
    html: htmlLista,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#002D56", // Púrpura Medianoche
    confirmButtonText: "Sí, enviar a todos",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Procesando envíos...",
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await request("enviarMasivoFase3");
      if (res.status === "success") {
        const idsActualizados = candidatos.map((c) => c.id_pedido);
        actualizarEstadoLocal(idsActualizados, 3, "ENVIADO_FASE3");
        await obtenerDatos(true, true);
        Swal.fire("Completado", res.message, "success");
      } else {
        Swal.fire("Error", res.message, "error");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo completar la operación", "error");
    }
  }
}

async function reenviarEmailFase4(id) {
  const reg = window[`regData_${id}`];
  const nombreEstudiante = reg ? reg.integrante_1 : "el estudiante";
  const confirm = await Swal.fire({
    title: "¿Enviar preguntas de defensa?",
    text: `Se enviará el enlace de las preguntas de Fase 04 a \n ${nombreEstudiante}.`,
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#0A1F44", // Lavanda Intenso
    confirmButtonText: "Sí, enviar preguntas",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({ title: "Enviando...", didOpen: () => Swal.showLoading() });
    try {
      const res = await request("enviarEmailFase4", { id });
      if (res.status === "success") {
        actualizarEstadoLocal([id], 4, "ENVIADO_FASE4");
        Swal.fire("¡Enviado!", res.message, "success");
      } else {
        Swal.fire("Error", res.message, "warning");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo conectar con el servidor", "error");
    }
  }
}

async function enviarTodosFase4() {
  if (!estadoTabla.registros) return;
  const candidatos = estadoTabla.registros.filter(
    (reg) =>
      reg.tipo_hoja === tipoHojaActual &&
      reg.estado_fase0 !== "NO_APTO_FASE0" &&
      reg.estado_fase4 &&
      reg.estado_fase4.toUpperCase().includes("COMPLETADO") &&
      reg.url_doc_fase4,
  );

  if (candidatos.length === 0) {
    return Swal.fire(
      "Atención",
      "No hay preguntas listas para enviar.",
      "info",
    );
  }

  const listaCorreos = candidatos.map((c) => `<li>${c.correo}</li>`).join("");
  const htmlLista = `<p>Se enviarán preguntas a <b>${candidatos.length}</b> equipos:</p><div style="max-height: 150px; overflow-y: auto; text-align: left; background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px solid #dee2e6;"><ul style="margin:0; padding-left: 20px; font-size: 0.9rem;">${listaCorreos}</ul></div>`;

  const confirm = await Swal.fire({
    title: "¿Enviar preguntas en masa (Fase 4)?",
    html: htmlLista,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#0A1F44", // Lavanda Intenso
    confirmButtonText: "Sí, enviar a todos",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Procesando envíos...",
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await request("enviarMasivoFase4");
      if (res.status === "success") {
        const idsActualizados = candidatos.map((c) => c.id_pedido);
        actualizarEstadoLocal(idsActualizados, 4, "ENVIADO_FASE4");
        await obtenerDatos(true, true);
        Swal.fire("Completado", res.message, "success");
      } else {
        Swal.fire("Error", res.message, "error");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo completar la operación", "error");
    }
  }
}

async function reenviarEmailFase6(id) {
  const reg = window[`regData_${id}`];
  const nombreEstudiante = reg ? reg.integrante_1 : "el estudiante";
  const nota = reg ? reg.nota_final_fase6 : "?";

  const confirm = await Swal.fire({
    title: "¿Enviar Nota Final (Fase 4.2)?",
    text: `Se enviará la nota final [${nota}] a \n ${nombreEstudiante}.`,
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#002D56", // Morado JVN
    confirmButtonText: "Sí, enviar nota",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({ title: "Enviando...", didOpen: () => Swal.showLoading() });
    try {
      const res = await request("enviarEmailFase6", { id });
      if (res.status === "success") {
        actualizarEstadoLocal([id], 6, "ENVIADO_FASE6"); // Actualizar UI
        Swal.fire("¡Enviado!", res.message, "success");
      } else {
        Swal.fire("Error", res.message, "warning");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo conectar con el servidor", "error");
    }
  }
}

async function enviarTodosFase6() {
  if (!estadoTabla.registros) return;
  const candidatos = estadoTabla.registros.filter(
    (reg) =>
      reg.tipo_hoja === tipoHojaActual &&
      reg.estado_fase0 !== "NO_APTO_FASE0" &&
      reg.estado_fase6 &&
      reg.estado_fase6.toUpperCase().includes("COMPLETADO") &&
      reg.nota_final_fase6,
  );

  if (candidatos.length === 0) {
    return Swal.fire(
      "Atención",
      "No hay notas finales listas para enviar.",
      "info",
    );
  }

  const listaCorreos = candidatos
    .map((c) => `<li>${c.correo} - Nota: ${c.nota_final_fase6}</li>`)
    .join("");
  const htmlLista = `<p>Se enviará la nota final a <b>${candidatos.length}</b> estudiantes:</p><div style="max-height: 150px; overflow-y: auto; text-align: left; background: #f8f9fa; padding: 10px; border-radius: 5px; border: 1px solid #dee2e6;"><ul style="margin:0; padding-left: 20px; font-size: 0.9rem;">${listaCorreos}</ul></div>`;

  const confirm = await Swal.fire({
    title: "¿Enviar Notas en Masa (Fase 4.2)?",
    html: htmlLista,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#002D56", // Morado JVN
    confirmButtonText: "Sí, enviar a todos",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Procesando envíos...",
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await request("enviarMasivoFase6");
      if (res.status === "success") {
        const idsActualizados = candidatos.map((c) => c.id_pedido);
        actualizarEstadoLocal(idsActualizados, 6, "ENVIADO_FASE6");
        await obtenerDatos(true, true);
        Swal.fire("Completado", res.message, "success");
      } else {
        Swal.fire("Error", res.message, "error");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo completar la operación", "error");
    }
  }
}

/* --- MODIFICACIÓN EN admin.js --- */
function actualizarEstadoLocal(ids, fase, nuevoEstado) {
  if (!estadoTabla.registros) return;

  // Guardamos la página actual para que el usuario no pierda su posición
  const paginaActual = tabla ? tabla.page() : 0;

  ids.forEach((id) => {
    // Buscamos en el array global de registros
    const reg = estadoTabla.registros.find((r) => r.id_pedido === id);
    if (reg) {
      // Actualizamos el estado según la fase
      if (fase === 0) reg.estado_fase0 = nuevoEstado;
      else if (fase === 1) reg.estado = nuevoEstado;
      else if (fase === 2) reg.estado_fase2 = nuevoEstado;
      else if (fase === 3) reg.estado_fase3 = nuevoEstado;
      else if (fase === 4) reg.estado_fase4 = nuevoEstado;
      else if (fase === 5) reg.estado_fase5 = nuevoEstado;
      else if (fase === 6) reg.estado_fase6 = nuevoEstado;

      // Sincronizamos con el objeto de acceso rápido por ID
      window[`regData_${id}`] = reg;
    }
  });

  // Forzamos el redibujado completo de la tabla con los nuevos datos del objeto
  procesarYRenderizarTabla(estadoTabla);

  // Restauramos la página donde estaba el usuario
  if (tabla) {
    tabla.page(paginaActual).draw("page");
  }
}

// ==========================================
// 11. Operaciones Especiales y Motores
// ==========================================

async function forzarRedaccionAsync() {
  const confirm = await Swal.fire({
    title: "¿Iniciar motor de IA?",
    text: "Esto ordenará a JVN buscar registros PENDIENTES y redactarlos en segundo plano.",
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#dc3545",
    confirmButtonText: "Sí, iniciar",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Conectando...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await request("forzarEjecucionAsync");
      if (res.status === "success") {
        await obtenerDatos(true, true);
        Swal.fire({
          title: "¡Motor Iniciado!",
          text: "Se ejecutará en la nube.",
          icon: "success",
          confirmButtonText: "Entendido",
        });
      } else {
        Swal.fire("Error del Motor", res.message, "error");
      }
    } catch (error) {
      Swal.fire("Error", "No se pudo conectar con el servidor.", "error");
    }
  }
}

async function exportarAReporteFase6() {
  const confirm = await Swal.fire({
    title: "¿Enviar datos al Reporte?",
    text: "Todos los registros actuales se añadirán al final de la hoja 'Reporte'. Recuerda haber limpiado o resguardado los datos de destino para evitar duplicados.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#F15A24", // Morado JVN
    confirmButtonText: "Sí, enviar",
    cancelButtonText: "Cancelar",
  });

  if (confirm.isConfirmed) {
    Swal.fire({
      title: "Exportando registros...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const res = await request("exportarFase6");
      if (res.status === "success") {
        Swal.fire("¡Listo!", res.message, "success");
      } else {
        Swal.fire("Error", res.message, "error");
      }
    } catch (e) {
      Swal.fire(
        "Error",
        "No se pudo conectar al servidor para realizar la exportación.",
        "error",
      );
    }
  }
}
