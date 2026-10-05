# PowerShell script to update all import statements from snake_case to PascalCase

$replacements = @{
    'failures.dart' = 'Failures.dart'
    'dio_client.dart' = 'DioClient.dart'
    'app_router.dart' = 'AppRouter.dart'
    'responsive_layout.dart' = 'ResponsiveLayout.dart'
    'application_repository_impl.dart' = 'ApplicationRepositoryImpl.dart'
    'auth_repository_impl.dart' = 'AuthRepositoryImpl.dart'
    'dashboard_repository_impl.dart' = 'DashboardRepositoryImpl.dart'
    'establishment_repository_impl.dart' = 'EstablishmentRepositoryImpl.dart'
    'offline_service.dart' = 'OfflineService.dart'
    'application_entity.dart' = 'ApplicationEntity.dart'
    'dashboard_stats_entity.dart' = 'DashboardStatsEntity.dart'
    'establishment_entity.dart' = 'EstablishmentEntity.dart'
    'user_entity.dart' = 'UserEntity.dart'
    'application_repository.dart' = 'ApplicationRepository.dart'
    'auth_repository.dart' = 'AuthRepository.dart'
    'dashboard_repository.dart' = 'DashboardRepository.dart'
    'establishment_repository.dart' = 'EstablishmentRepository.dart'
    'admin_dashboard_screen.dart' = 'AdminDashboardScreen.dart'
    'admin_login_screen.dart' = 'AdminLoginScreen.dart'
    'task_queue_screen.dart' = 'TaskQueueScreen.dart'
    'application_provider.dart' = 'ApplicationProvider.dart'
    'application_form_screen.dart' = 'ApplicationFormScreen.dart'
    'application_type_selection_screen.dart' = 'ApplicationTypeSelectionScreen.dart'
    'inspection_form_screen.dart' = 'InspectionFormScreen.dart'
    'my_assignments_screen.dart' = 'MyAssignmentsScreen.dart'
    'auth_provider.dart' = 'AuthProvider.dart'
    'dashboard_provider.dart' = 'DashboardProvider.dart'
    'dashboard_screen.dart' = 'DashboardScreen.dart'
    'establishment_provider.dart' = 'EstablishmentProvider.dart'
    'establishment_form_screen.dart' = 'EstablishmentFormScreen.dart'
    'establishment_list_screen.dart' = 'EstablishmentListScreen.dart'
    'app_shell.dart' = 'AppShell.dart'
}

# Get all Dart files
$dartFiles = Get-ChildItem -Path "lib" -Filter "*.dart" -Recurse

foreach ($file in $dartFiles) {
    $content = Get-Content $file.FullName -Raw
    $modified = $false
    
    foreach ($old in $replacements.Keys) {
        $new = $replacements[$old]
        if ($content -match $old) {
            $content = $content -replace [regex]::Escape($old), $new
            $modified = $true
        }
    }
    
    if ($modified) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "Updated: $($file.FullName)"
    }
}

Write-Host "Import update complete!"
