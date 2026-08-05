const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwMNTyzrulP88Riq_v2QTtJbcLIBfgS1U2jvV9GSbl_UswHqY9kX4TW02LZifkrq3VE/exec";
let registrosGlobal = [];
let selectedId = null;
let filtroActivo = "todos";

// --- CONTROL DE SESIÓN AL INICIAR ---
$(document).ready(() => {
  const savedUser = localStorage.getItem("docente_user");
  const savedPass = localStorage.getItem("docente_pass");
  if (savedUser && savedPass) {
    autoIniciarSesion(savedUser, savedPass);
  } else {
    $("#login-container").removeClass("d-none").addClass("d-flex");
    $("#main-dashboard").addClass("d-none");
  }
  // Manejador de eventos para el cambio de filtros
  $(document).on("click", ".btn-filtro", function () {
    $(".btn-filtro").removeClass("active");
    $(this).addClass("active");
    filtroActivo = $(this).data("filtro");
    renderizarLista(registrosGlobal);
  });
});

// Listener para disparar el login con la tecla Enter
$(document).on("keypress", function (e) {
  if (e.which === 13 && $("#login-container").is(":visible")) {
    iniciarSesion();
  }
});

// --- FUNCIÓN PETICIÓN CENTRALIZADA ANTI-CACHÉ ---
async function request(action, data = {}) {
  const urlAntiCache = `${WEB_APP_URL}?t=${Date.now()}`;
  const response = await fetch(urlAntiCache, {
    method: "POST",
    body: JSON.stringify({ action, data }),
    cache: "no-store",
  });
  return await response.json();
}

// --- FLUJO DE INICIO DE SESIÓN ---
async function iniciarSesion() {
  const user = $("#login_user").val().trim();
  const pass = $("#login_pass").val().trim();
  const btn = $("#btn-login");
  const btnText = btn.find(".btn-text");
  const spinner = btn.find(".spinner-border");

  if (!user || !pass) {
    return Swal.fire("Atención", "Ingresa tus credenciales.", "warning");
  }

  btn.prop("disabled", true);
  btnText.addClass("d-none");
  spinner.removeClass("d-none");

  try {
    // Enviamos el rol "docente" para validar el acceso
    const res = await request("login", { user, pass, role: "docente" });

    if (res.status === "success") {
      localStorage.setItem("docente_user", user);
      localStorage.setItem("docente_pass", pass);

      // Asignamos el nombre del usuario logueado en la barra de navegación
      $("#logged-user").text(user);

      // Iniciamos animación de salida del login
      $("#login-container").animate({ opacity: 0 }, 300, function () {
        $(this).removeClass("d-flex").addClass("d-none");
        $("#splash-screen").fadeIn(300);

        let bar = document.getElementById("splash-progress");
        let text = document.getElementById("splash-text");

        if (bar) bar.style.width = "40%";
        text.innerText = "Autenticación exitosa. Cargando expedientes...";

        // --- CAMBIO CLAVE: Procesamiento de datos recibidos ---
        if (res.datos && res.datos.registros) {
          registrosGlobal = res.datos.registros;
          renderizarLista(registrosGlobal); // Dibujamos la lista en el DOM oculto
        }

        if (bar) bar.style.width = "100%";
        text.innerText = "¡Bienvenido, Docente!";

        // Finalizamos splash y mostramos el dashboard
        setTimeout(() => {
          $("#splash-screen").fadeOut(400, () => {
            $("#main-dashboard").hide().removeClass("d-none").fadeIn(400);
            // Forzamos un pequeño ajuste de scroll por si el DOM no calculó bien las alturas
            $("#listaEstudiantes").scrollTop(0);
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

// --- MODIFICACIÓN EN docente.js: Función autoIniciarSesion ---
async function autoIniciarSesion(user, pass) {
  $("#login-container").addClass("d-none");
  $("#splash-screen").show();

  let bar = document.getElementById("splash-progress");
  let text = document.getElementById("splash-text");

  if (bar) bar.style.width = "30%";
  text.innerText = "Restaurando sesión docente...";

  try {
    const res = await request("login", { user, pass, role: "docente" });

    if (res.status === "success") {
      if (bar) bar.style.width = "70%";
      text.innerText = "Sincronizando registros de evaluación...";

      // Asignamos el nombre del usuario restaurado en la barra de navegación
      $("#logged-user").text(user);

      if (res.datos && res.datos.registros) {
        registrosGlobal = res.datos.registros;
        renderizarLista(registrosGlobal);
      }

      if (bar) bar.style.width = "100%";
      text.innerText = "Acceso concedido.";

      setTimeout(() => {
        $("#splash-screen").fadeOut(400, () => {
          $("#main-dashboard").hide().removeClass("d-none").fadeIn(400);
        });
      }, 500);
    } else {
      localStorage.removeItem("docente_user");
      localStorage.removeItem("docente_pass");
      $("#splash-screen").hide();
      $("#login-container")
        .removeClass("d-none")
        .addClass("d-flex")
        .css("opacity", 1);
      Swal.fire(
        "Sesión Expirada",
        "Por favor, inicia sesión nuevamente.",
        "warning",
      );
    }
  } catch (error) {
    $("#splash-screen").hide();
    $("#login-container")
      .removeClass("d-none")
      .addClass("d-flex")
      .css("opacity", 1);
    Swal.fire(
      "Error de Red",
      "No se pudo validar la sesión automática.",
      "error",
    );
  }
}

function cerrarSesion() {
  localStorage.removeItem("docente_user");
  localStorage.removeItem("docente_pass");
  window.location.reload();
}

// --- ACTUALIZACIÓN MANUAL DE DATOS ---
async function cargarDatos() {
  Swal.fire({
    title: "Actualizando registros...",
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading(),
  });

  try {
    // Obtenemos el usuario de la sesión activa
    const savedUser = localStorage.getItem("docente_user");

    // Enviamos el usuario para que el servidor filtre correctamente
    const data = await request("leerDocente", { user: savedUser });
    registrosGlobal = data.registros;

    renderizarLista(registrosGlobal);

    // Si había un estudiante seleccionado, actualizar sus datos sin recargar el video
    if (selectedId) {
      const reg = registrosGlobal.find((r) => r.id_pedido === selectedId);
      if (reg) {
        $("#inputNotaF5").val(reg.nota_fase5 || "");
      }
    }

    Swal.close();
  } catch (e) {
    Swal.fire("Error", "No se pudo conectar al servidor.", "error");
  }
}

// Función para parsear de forma robusta las fechas en formato "d/M/yyyy H:m:s" o similar
function parseFecha(fechaStr) {
  if (!fechaStr) return new Date(0);
  if (fechaStr instanceof Date) return fechaStr;

  // En caso de que se reciba una cadena de texto en formato ISO
  if (typeof fechaStr === "string" && fechaStr.includes("T")) {
    const parsed = new Date(fechaStr);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // Descomponer el formato manual "d/MM/yyyy HH:mm:ss"
  const partes = fechaStr.toString().trim().split(" ");
  if (partes.length >= 1) {
    const fechaPartes = partes[0].split("/");
    if (fechaPartes.length === 3) {
      const dia = parseInt(fechaPartes[0], 10);
      const mes = parseInt(fechaPartes[1], 10) - 1; // En JavaScript los meses inician en 0
      const anio = parseInt(fechaPartes[2], 10);

      let hora = 0,
        min = 0,
        seg = 0;
      if (partes.length >= 2) {
        const horaPartes = partes[1].split(":");
        if (horaPartes.length >= 3) {
          hora = parseInt(horaPartes[0], 10);
          min = parseInt(horaPartes[1], 10);
          seg = parseInt(horaPartes[2], 10);
        }
      }
      const d = new Date(anio, mes, dia, hora, min, seg);
      if (!isNaN(d.getTime())) return d;
    }
  }

  const fallback = new Date(fechaStr);
  return isNaN(fallback.getTime()) ? new Date(0) : fallback;
}

function renderizarLista(registros) {
  let html = "";
  if (registros.length === 0) {
    html = `<div class="p-4 text-center text-muted small">No hay videos de sustentación.</div>`;
  } else {
    // 1. Filtrar registros según el estado activo seleccionado por el usuario
    let registrosFiltrados = [...registros];
    if (filtroActivo === "pendiente") {
      registrosFiltrados = registrosFiltrados.filter(
        (reg) => (reg.estado_fase5 || "").toUpperCase() === "POR_CALIFICAR",
      );
    } else if (filtroActivo === "calificado") {
      registrosFiltrados = registrosFiltrados.filter(
        (reg) => (reg.estado_fase5 || "").toUpperCase() === "CALIFICADO",
      );
    }

    if (registrosFiltrados.length === 0) {
      html = `<div class="p-4 text-center text-muted small">No se encontraron registros con este filtro.</div>`;
    } else {
      // 2. Ordenar de forma descendente usando parseFecha
      const registrosOrdenados = registrosFiltrados.sort((a, b) => {
        const dateA = parseFecha(a.f_registro);
        const dateB = parseFecha(b.f_registro);
        return dateB - dateA; // Orden descendente (más recientes arriba)
      });

      registrosOrdenados.forEach((reg) => {
        const estado = (reg.estado_fase5 || "").toUpperCase();
        let badgeClass = "bg-secondary";
        let textoEstado = estado;

        if (estado === "CALIFICADO") {
          badgeClass = "bg-success";
          textoEstado = '<i class="fas fa-check-circle me-1"></i> Calificado';
        } else if (estado === "POR_CALIFICAR") {
          badgeClass = "bg-warning text-dark";
          textoEstado = '<i class="fas fa-clock me-1"></i> Pendiente';
        }

        // Persistencia de clase activa
        const activeClass = selectedId === reg.id_pedido ? "active" : "";

        html += `
              <div class="student-item ${activeClass}" id="item-${reg.id_pedido}" onclick="seleccionarEstudiante('${reg.id_pedido}')">
                  <div class="fw-bold mb-1" style="font-size: 0.9rem; color: #0d47a1;">${reg.integrante_1}</div>
                  ${reg.integrante_2 ? `<div class="small text-muted mb-1" style="font-size: 0.75rem;">& ${reg.integrante_2}</div>` : ""}
                  <div class="small text-muted text-truncate mb-2" style="font-size: 0.8rem;" title="${reg.tema}">${reg.tema}</div>
                  <div class="d-flex justify-content-between align-items-center">
                      <span class="badge ${badgeClass} shadow-sm" style="font-size: 0.7rem; font-weight: 600; text-transform: uppercase;">${textoEstado}</span>
                      <span class="fw-bold text-primary" style="font-size: 0.85rem;">${reg.nota_fase5 ? "Nota: " + reg.nota_fase5 : "--"}</span>
                  </div>
              </div>
            `;
      });
    }
  }
  $("#listaEstudiantes").html(html);
}

function seleccionarEstudiante(id) {
  selectedId = id;
  $(".student-item").removeClass("active");
  $(`#item-${id}`).addClass("active");

  const reg = registrosGlobal.find((r) => r.id_pedido === id);
  if (!reg) return;

  $("#panelVacio").addClass("d-none");
  $("#panelEvaluacion").removeClass("d-none");

  const videoId = extraerYoutubeId(reg.url_video_fase5);
  if (videoId) {
    $("#videoWrapper").html(
      `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&vq=hd1080" allow="autoplay; encrypted-media" allowfullscreen></iframe>`,
    );
  } else {
    $("#videoWrapper").html(
      `<div class="d-flex align-items-center justify-content-center h-100 text-white bg-dark">URL de video no válida o no es YouTube</div>`,
    );
  }

  $("#inputNotaF5").val(reg.nota_fase5 || "");
  $("#inputObsF5").val(reg.obs_fase5 || "");

  const preguntas = [
    reg.p1_fase4,
    reg.p2_fase4,
    reg.p3_fase4,
    reg.p4_fase4,
    reg.p5_fase4,
    reg.p6_fase4,
  ];
  let phtml = "";
  preguntas.forEach((p, i) => {
    if (p && p.trim() !== "") {
      phtml += `<div class="pregunta-box"><b>Pregunta ${i + 1}:</b> ${p}</div>`;
    }
  });
  $("#preguntasContainer").html(
    phtml ||
      "<span class='text-muted'>No se encontraron preguntas de Fase 04.</span>",
  );
}

async function enviarCalificacion() {
  const nota = $("#inputNotaF5").val();
  const obs = $("#inputObsF5").val();

  // Validación escala JVN (0-20)
  if (!nota || nota < 0 || nota > 20) {
    return Swal.fire("Error", "Ingresa una nota válida entre 0 y 20", "error");
  }

  Swal.fire({
    title: "Guardando Calificación...",
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading(),
  });

  try {
    const data = await request("calificarDefensa", {
      idPedido: selectedId,
      nota: nota,
      obs: obs,
    });

    if (data.status === "success") {
      // Actualización inmediata de la memoria local
      const regIndex = registrosGlobal.findIndex(
        (r) => r.id_pedido === selectedId,
      );
      if (regIndex !== -1) {
        registrosGlobal[regIndex].nota_fase5 = nota;
        registrosGlobal[regIndex].obs_fase5 = obs;
        registrosGlobal[regIndex].estado_fase5 = "CALIFICADO";
      }

      // Refrescar solo la lista lateral para mostrar el badge verde y la nota
      renderizarLista(registrosGlobal);

      Swal.fire(
        "¡Éxito!",
        "Calificación JVN registrada correctamente.",
        "success",
      );
    } else {
      Swal.fire("Error", data.message, "error");
    }
  } catch (e) {
    Swal.fire("Error", "Error de conexión con el servidor JVN.", "error");
  }
}

function extraerYoutubeId(url) {
  if (!url) return null;
  const regExp =
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length == 11 ? match[2] : null;
}
