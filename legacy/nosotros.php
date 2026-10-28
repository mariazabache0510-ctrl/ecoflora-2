<?php
require_once __DIR__ . '/config/conexion.php';
include __DIR__ . '/includes/header.php';
?>

<div class="container my-5">
    <div class="row align-items-center g-5">
        <div class="col-lg-6">
            <img src="https://images.unsplash.com/photo-1416879595882-3373a0480b5b?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80" class="img-fluid rounded-4 shadow" alt="Nuestro vivero">
        </div>
        <div class="col-lg-6">
            <h1 class="fw-bold mb-4" style="color: var(--verde-oscuro);">Somos EcoFlora</h1>
            <p class="lead">Desde 2020 conectamos personas con la naturaleza. Somos un vivero especializado en plantas de interior, exterior, suculentas y orquídeas de la más alta calidad.</p>
            <p>Nuestro equipo de expertos está listo para asesorarte en el cuidado de cada planta. Hacemos domicilios seguros a toda la ciudad para que la naturaleza llegue a tu hogar sin complicaciones.</p>
            <div class="row mt-4">
                <div class="col-4 text-center"><h3 class="fw-bold" style="color: var(--verde-medio);">500+</h3><small class="text-muted">Plantas vendidas</small></div>
                <div class="col-4 text-center"><h3 class="fw-bold" style="color: var(--verde-medio);">200+</h3><small class="text-muted">Clientes felices</small></div>
                <div class="col-4 text-center"><h3 class="fw-bold" style="color: var(--verde-medio);">50+</h3><small class="text-muted">Especies</small></div>
            </div>
        </div>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
