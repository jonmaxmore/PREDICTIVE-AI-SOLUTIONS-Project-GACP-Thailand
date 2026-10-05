'use client';


import { Container } from '@/components/ui/layout-utils';
import { ThemeIcon, UnstyledButton } from '@/components/ui/icon-buttons';
import { SummaryHeader } from '@/components/feature';
import { Modal } from '@/components/ui/overlays';
import { Switch } from '@/components/ui/switch';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Button } from '@/components/ui/primitives/button';
import { Input as PasswordInput } from '@/components/ui/primitives/input';
import { Alert } from '@/components/ui/alert';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/services/auth-provider';
import { Icons } from '@/components/ui/icons';
import { useLanguage } from '@/lib/i18n/language-context';
import { apiClient } from '@/lib/api';

import { useDisclosure } from '@/hooks/use-disclosure';

interface SettingsPageDictionary {
    edit?: string;
    notifications?: string;
}

export default function SettingsPage() {
    const router = useRouter();
    const { user, logout } = useAuth();
    const { language, setLanguage, dict } = useLanguage();
    const { colorScheme, setColorScheme } = useColorScheme();
    const settingsPageDict = (dict as { settingsPage?: SettingsPageDictionary }).settingsPage;
    const [mounted, setMounted] = useState(false);

    // Change Password Modal
    const [passwordModalOpened, { open: openPasswordModal, close: closePasswordModal }] = useDisclosure(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordSuccess, setPasswordSuccess] = useState(false);
    const [passwordLoading, setPasswordLoading] = useState(false);

    // Notifications
    const [notificationsEnabled, setNotificationsEnabled] = useState(true);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Dark Mode toggle
    const handleDarkModeToggle = () => {
        setColorScheme(colorScheme === 'dark' ? 'light' : 'dark');
    };

    const handleLanguageChange = () => {
        const newLang = language === 'th' ? 'en' : 'th';
        setLanguage(newLang);
    };

    const handleLogout = async () => {
        await logout();
      router.push('/auth/health/login');
    };

    const handleChangePassword = async () => {
        setPasswordError(null);
        setPasswordSuccess(false);

        // Validation
        if (!currentPassword || !newPassword || !confirmPassword) {
            setPasswordError(dict.settings.fillAllFields);
            return;
        }
        if (newPassword.length < 8) {
            setPasswordError(dict.settings.passwordTooShort);
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordError(dict.settings.passwordsDoNotMatch);
            return;
        }

        setPasswordLoading(true);
        try {
            const result = await apiClient.post<unknown>('/auth/health/change-password', {
                oldPassword: currentPassword,
                newPassword
            });

            if (result.success) {
                setPasswordSuccess(true);
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                setTimeout(() => {
                    closePasswordModal();
                    setPasswordSuccess(false);
                }, 2000);
            } else {
                setPasswordError(result.error || dict.settings.changePasswordFail);
            }
        } catch (_error) {
            setPasswordError(dict.settings.genericError);
        } finally {
            setPasswordLoading(false);
        }
    };

    const handleNotificationToggle = () => {
        const newValue = !notificationsEnabled;
        setNotificationsEnabled(newValue);
        localStorage.setItem('notificationsEnabled', JSON.stringify(newValue));
    };

    const sections = [
        {
            title: dict.settings.general || "General",
            items: [
                {
                    icon: Icons.Globe,
                    color: 'blue',
                    label: dict.settings.language || "Language",
                    value: language === 'th' ? 'ไทย' : 'English',
                    action: handleLanguageChange,
                    type: 'button' as const
                },
                {
                    icon: Icons.User,
                    color: 'green',
                    label: dict.sidebar.profile || "Profile",
                    value: user?.firstName || (settingsPageDict?.edit || "Edit"),
                    action: () => router.push('/health/profile'),
                    type: 'button' as const
                }
            ]
        },
        {
            title: dict.settings.security || "Security",
            items: [
                {
                    icon: Icons.Lock,
                    color: 'orange',
                    label: dict.settings.changePassword || "Change Password",
                    value: '***********',
                    action: openPasswordModal,
                    type: 'button' as const
                }
            ]
        },
        {
            title: dict.settings.notifications || "Notifications",
            items: [
                {
                    icon: Icons.Bell,
                    color: 'violet',
                    label: settingsPageDict?.notifications || "รับการแจ้งเตือน",
                    value: notificationsEnabled ? 'เปิด' : 'ปิด',
                    action: handleNotificationToggle,
                    type: 'switch' as const,
                    checked: notificationsEnabled
                }
            ]
        },
        {
            title: dict.settings.display,
            items: [
                {
                    icon: Icons.Moon,
                    color: 'dark',
                    label: `${dict.settings.darkMode} (Dark Mode)`,
                    value: colorScheme === 'dark' ? (dict.settingsPage.notificationValue || 'On') : (language === 'en' ? 'Off' : 'ปิด'),
                    action: handleDarkModeToggle,
                    type: 'switch' as const,
                    checked: colorScheme === 'dark'
                }
            ]
        }
    ];

    if (!mounted) {
        return null;
    }

    return (
        <Container size="full" className="animate-fade-in">
            {/* Wave E.2-B: SummaryHeader replaces inline icon + h2 + p header.
                ThemeIcon is no longer needed here since SummaryHeader has its
                own visual identity; settings sections below stay unchanged. */}
            <SummaryHeader
                eyebrow={dict.eyebrow.applicantSettings}
                title={dict.settings.title || 'Settings'}
                description={dict.settings.subtitle || 'System configuration and preferences'}
            />

            <div className="mt-6 flex flex-col gap-5">
                {sections.map((section, idx) => (
                    <div className="overflow-hidden rounded-lg bg-card shadow-sm" key={idx}>
                        <div className="border-b border-mantine-gray-2 px-5 py-3">
                            <p className="text-xs font-bold text-muted-foreground">
                                {section.title}
                            </p>
                        </div>
                        <div className="flex flex-col">
                            {section.items.map((item, itemIdx) => (
                                item.type === 'switch' ? (
                                    <div
                                        key={itemIdx}
                                        className={`p-5${itemIdx !== section.items.length - 1 ? ' border-b border-border' : ''}`}
                                    >
                                        <div className="flex flex-wrap items-center">
                                            <div className="flex flex-wrap items-center">
                                                <ThemeIcon size="lg" color={item.color} >
                                                    <item.icon size={20} />
                                                </ThemeIcon>
                                                <p className="font-medium">{item.label}</p>
                                            </div>
                                            <Switch
                                                checked={item.checked}
                                                onChange={item.action}
                                                color="green"
                                                size="md"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <UnstyledButton
                                        key={itemIdx}
                                        onClick={item.action}
                                        style={{
                                            // inline style beats the component's base `border-none`; --border token (no raw hex)
                                            borderBottom: itemIdx !== section.items.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                                            transition: 'background-color 0.2s',
                                        }}
                                    >
                                        <div className="flex flex-wrap items-center">
                                            <div className="flex flex-wrap items-center">
                                                <ThemeIcon size="lg" color={item.color} >
                                                    <item.icon size={20} />
                                                </ThemeIcon>
                                                <p className="font-medium">{item.label}</p>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-medium text-muted-foreground">{item.value}</p>
                                                <Icons.ChevronRight size={16} className="text-mantine-gray-5" />
                                            </div>
                                        </div>
                                    </UnstyledButton>
                                )
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <Button
                onClick={handleLogout}

                color="red"
                size="lg"

                leftSection={<Icons.Logout size={20} />}
            >
                {dict.sidebar.logout || "Log out"}
            </Button>

            {/* Change Password Modal */}
            <Modal
                opened={passwordModalOpened}
                onClose={closePasswordModal}
                title={<p className="text-lg font-semibold">{dict.settings.changePassword}</p>}
                centered
                size="sm"
            >
                <div className="flex flex-col gap-4">
                    {passwordError && (
                        <Alert color="red" icon={<Icons.Warning size={16} />}>
                            {passwordError}
                        </Alert>
                    )}
                    {passwordSuccess && (
                        <Alert color="green" icon={<Icons.Check size={16} />}>
                            {dict.settings.changePasswordSuccess}
                        </Alert>
                    )}
                    <PasswordInput
                        label={dict.settings.currentPassword}
                        placeholder={dict.settings.passwordPlaceholder}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.currentTarget.value)}
                        required
                    />
                    <PasswordInput
                        label={dict.settings.newPassword}
                        placeholder={dict.settings.newPasswordPlaceholder}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.currentTarget.value)}
                        required
                    />
                    <PasswordInput
                        label={dict.settings.confirmNewPassword}
                        placeholder={dict.settings.confirmPasswordPlaceholder}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                        required
                    />
                    <div className="mt-4 flex flex-wrap items-center">
                        <Button variant="subtle" onClick={closePasswordModal}>
                            {dict.common.cancel}
                        </Button>
                        <Button
                            color="green"
                            onClick={handleChangePassword}
                            loading={passwordLoading}
                        >
                            {dict.settings.changePassword}
                        </Button>
                    </div>
                </div>
            </Modal>
        </Container>
    );
}
