<?php
require_once __DIR__ . '/config/conexion.php';
$error = '';
$exito = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $nombre = trim($_POST['nombre']);
    $usuario = trim($_POST['usuario']);
    $email = trim($_POST['email']);
    $telefono = trim($_POST['telefono']);
    $direccion = trim($_POST['direccion']);
    $ciudad = trim($_POST['ciudad']);
    $password = trim($_POST['password']);
    $confirmar = trim($_POST['confirmar']);
    if (empty($nombre) || empty($usuario) || empty($email) || empty($password)) $error = "Los campos con * son obligatorios.";
    elseif ($password !== $confirmar) $error = "Las contraseñas no coinciden.";
    elseif (strlen($password) < 5) $error = "La contraseña debe tener al menos 5 caracteres.";
    else {
        $stmt = $conexion->prepare("SELECT id_usuario FROM usuarios WHERE usuario = ? OR email = ?");
        $stmt->bind_param("ss", $usuario, $email);
        $stmt->execute();
        if ($stmt->get_result()->num_rows > 0) $error = "El usuario o email ya están registrados.";
        else {
            $hash = password_hash($password, PASSWORD_DEFAULT);
            $stmt = $conexion->prepare("INSERT INTO usuarios (nombre, usuario, email, password, telefono, direccion, ciudad) VALUES (?,?,?,?,?,?,?)");
            $stmt->bind_param("sssssss", $nombre, $usuario, $email, $hash, $telefono, $direccion, $ciudad);
            if ($stmt->execute()) $exito = "Registro exitoso. Ahora puedes iniciar sesión.";
            else $error = "Error al registrar. Intenta de nuevo.";
        }
    }
}
include __DIR__ . '/includes/header.php';
?>

<div class="container my-5">
    <div class="row justify-content-center">
        <div class="col-md-6">
            <div class="card shadow-lg border-0" style="border-radius: 20px;">
                <div class="card-header bg-white border-0 text-center pt-4"><h4 class="fw-bold">Crear cuenta</h4></div>
                <div class="card-body px-4">
                    <?php if($error): ?><div class="alert alert-danger"><?php echo $error; ?></div><?php endif; ?>
                    <?php if($exito): ?><div class="alert alert-success"><?php echo $exito; ?></div><?php endif; ?>
                    <form method="POST">
                        <div class="mb-3"><label class="form-label">Nombre completo *</label><input type="text" name="nombre" class="form-control" required></div>
                        <div class="row">
                            <div class="col-md-6 mb-3"><label class="form-label">Usuario *</label><input type="text" name="usuario" class="form-control" required></div>
                            <div class="col-md-6 mb-3"><label class="form-label">Email *</label><input type="email" name="email" class="form-control" required></div>
                        </div>
                        <div class="row">
                            <div class="col-md-6 mb-3"><label class="form-label">Teléfono</label><input type="text" name="telefono" class="form-control"></div>
                            <div class="col-md-6 mb-3"><label class="form-label">Ciudad</label><input type="text" name="ciudad" class="form-control"></div>
                        </div>
                        <div class="mb-3"><label class="form-label">Dirección</label><input type="text" name="direccion" class="form-control" placeholder="Calle, número, barrio"></div>
                        <div class="row">
                            <div class="col-md-6 mb-3"><label class="form-label">Contraseña *</label><input type="password" name="password" class="form-control" required></div>
                            <div class="col-md-6 mb-3"><label class="form-label">Confirmar *</label><input type="password" name="confirmar" class="form-control" required></div>
                        </div>
                        <button type="submit" class="btn btn-ecoflora w-100">Registrarme</button>
                    </form>
                    <div class="text-center mt-3"><small>¿Ya tienes cuenta? <a href="<?php echo BASE_URL; ?>/login.php" class="text-decoration-none fw-bold" style="color: var(--verde-medio);">Ingresa aquí</a></small></div>
                </div>
            </div>
        </div>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
