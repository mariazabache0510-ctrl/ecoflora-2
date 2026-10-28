<?php
require_once __DIR__ . '/config/conexion.php';
$exito = '';
$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $nombre = trim($_POST['nombre']);
    $email = trim($_POST['email']);
    $telefono = trim($_POST['telefono']);
    $asunto = trim($_POST['asunto']);
    $mensaje = trim($_POST['mensaje']);
    if (empty($nombre) || empty($email) || empty($mensaje)) {
        $error = "Completa los campos obligatorios.";
    } else {
        $stmt = $conexion->prepare("INSERT INTO contactos (nombre, email, telefono, asunto, mensaje) VALUES (?,?,?,?,?)");
        $stmt->bind_param("sssss", $nombre, $email, $telefono, $asunto, $mensaje);
        if ($stmt->execute()) $exito = "Mensaje enviado correctamente. Te contactaremos pronto.";
        else $error = "Error al enviar. Intenta de nuevo.";
    }
}
include __DIR__ . '/includes/header.php';
?>

<div class="container my-5">
    <div class="row g-5">
        <div class="col-lg-5">
            <h2 class="fw-bold mb-4" style="color: var(--verde-oscuro);">Contáctanos</h2>
            <p class="text-muted mb-4">¿Tienes dudas sobre el cuidado de una planta, disponibilidad o domicilios? Escríbenos.</p>
            <div class="d-flex mb-3"><i class="bi bi-geo-alt fs-4 me-3" style="color: var(--verde-medio);"></i><div><strong>Dirección</strong><p class="text-muted mb-0">Calle 123 #45-67, Bogotá</p></div></div>
            <div class="d-flex mb-3"><i class="bi bi-telephone fs-4 me-3" style="color: var(--verde-medio);"></i><div><strong>Teléfono</strong><p class="text-muted mb-0">(601) 123-4567</p></div></div>
            <div class="d-flex mb-3"><i class="bi bi-envelope fs-4 me-3" style="color: var(--verde-medio);"></i><div><strong>Email</strong><p class="text-muted mb-0">hola@ecoflora.com</p></div></div>
            <div class="d-flex"><i class="bi bi-clock fs-4 me-3" style="color: var(--verde-medio);"></i><div><strong>Horario</strong><p class="text-muted mb-0">Lun - Sáb: 8:00 a.m. - 6:00 p.m.</p></div></div>
        </div>
        <div class="col-lg-7">
            <div class="card shadow-sm border-0 p-4" style="border-radius: 20px;">
                <?php if($error): ?><div class="alert alert-danger"><?php echo $error; ?></div><?php endif; ?>
                <?php if($exito): ?><div class="alert alert-success"><?php echo $exito; ?></div><?php endif; ?>
                <form method="POST">
                    <div class="row">
                        <div class="col-md-6 mb-3"><label class="form-label">Nombre *</label><input type="text" name="nombre" class="form-control" required></div>
                        <div class="col-md-6 mb-3"><label class="form-label">Email *</label><input type="email" name="email" class="form-control" required></div>
                    </div>
                    <div class="row">
                        <div class="col-md-6 mb-3"><label class="form-label">Teléfono</label><input type="text" name="telefono" class="form-control"></div>
                        <div class="col-md-6 mb-3"><label class="form-label">Asunto</label><input type="text" name="asunto" class="form-control"></div>
                    </div>
                    <div class="mb-3"><label class="form-label">Mensaje *</label><textarea name="mensaje" class="form-control" rows="4" required></textarea></div>
                    <button type="submit" class="btn btn-ecoflora w-100">Enviar mensaje</button>
                </form>
            </div>
        </div>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
