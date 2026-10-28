<?php
require_once __DIR__ . '/config/conexion.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $usuario = trim($_POST['usuario']);
    $password = trim($_POST['password']);
    if (empty($usuario) || empty($password)) {
        $error = "Completa todos los campos.";
    } else {
        $stmt = $conexion->prepare("SELECT id_usuario, nombre, usuario, password, rol FROM usuarios WHERE usuario = ? OR email = ?");
        $stmt->bind_param("ss", $usuario, $usuario);
        $stmt->execute();
        $res = $stmt->get_result();
        if ($res->num_rows === 1) {
            $user = $res->fetch_assoc();
            if (password_verify($password, $user['password'])) {
                session_start();
                $_SESSION['id_usuario'] = $user['id_usuario'];
                $_SESSION['nombre'] = $user['nombre'];
                $_SESSION['usuario'] = $user['usuario'];
                $_SESSION['rol'] = $user['rol'];
                if (isset($_SESSION['sesion_carrito']) && !empty($_SESSION['sesion_carrito'])) {
                    foreach ($_SESSION['sesion_carrito'] as $id_planta => $cantidad) {
                        $stmt = $conexion->prepare("INSERT INTO carrito (id_usuario, id_planta, cantidad) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE cantidad = cantidad + ?");
                        $stmt->bind_param("iiii", $user['id_usuario'], $id_planta, $cantidad, $cantidad);
                        $stmt->execute();
                    }
                    unset($_SESSION['sesion_carrito']);
                }
                if ($user['rol'] === 'admin') header("Location: " . BASE_URL . "/admin/panel_admin.php");
                else header("Location: " . BASE_URL . "/index.php");
                exit();
            } else $error = "Contraseña incorrecta.";
        } else $error = "Usuario no encontrado.";
    }
}
include __DIR__ . '/includes/header.php';
?>

<div class="container my-5">
    <div class="row justify-content-center">
        <div class="col-md-5">
            <div class="card shadow-lg border-0" style="border-radius: 20px;">
                <div class="card-header bg-white border-0 text-center pt-4">
                    <i class="bi bi-flower1 fs-1" style="color: var(--verde-medio);"></i>
                    <h4 class="mt-2 fw-bold">Bienvenido a EcoFlora</h4>
                </div>
                <div class="card-body px-4 pb-4">
                    <?php if(isset($error)): ?><div class="alert alert-danger"><?php echo $error; ?></div><?php endif; ?>
                    <form method="POST">
                        <div class="mb-3"><label class="form-label">Usuario o Email</label><input type="text" name="usuario" class="form-control" required></div>
                        <div class="mb-3"><label class="form-label">Contraseña</label><input type="password" name="password" class="form-control" required></div>
                        <button type="submit" class="btn btn-ecoflora w-100">Ingresar</button>
                    </form>
                    <div class="text-center mt-3"><small>¿No tienes cuenta? <a href="<?php echo BASE_URL; ?>/registro.php" class="text-decoration-none fw-bold" style="color: var(--verde-medio);">Regístrate</a></small></div>
                </div>
            </div>
        </div>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
