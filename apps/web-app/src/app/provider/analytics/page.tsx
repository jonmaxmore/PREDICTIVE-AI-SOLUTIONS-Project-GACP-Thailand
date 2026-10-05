'use client';

import { useEffect, useState, useCallback, useMemo } from "react";
import { Spinner } from '@/components/ui/spinner';
import {
    BarChart3,
    Users,
    FileCheck,
    Coins,
    TrendingUp,
    Calendar,
    RefreshCcw,
    ArrowUpRight,
    ArrowDownRight
} from 'lucide-react';

import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/primitives/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/primitives/select';
import { Progress } from '@/components/ui/progress';
import { SummaryHeader } from '@/components/feature/summary-header';
import ProviderLayout from "../components/provider-layout";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { apiClient } from '@/lib/api/api-client';
import { useLanguage } from '@/lib/i18n/language-context';

// --- Types ---
interface AnalyticsData {
    period: string;
    applications: {
        total: number;
        new: number;
        renewal: number;
        approved: number;
        rejected: number;
        pending: number;
        trend: number;
    };
    financial: {
        revenue: number;
        pending: number;
        refunded: number;
        trend: number;
    };
    users: {
        totalApplicants: number;
        newApplicants: number;
        activeCertificates: number;
        trend: number;
    };
    performance: {
        avgProcessingDays: number;
        avgAuditDays: number;
        satisfactionRate: number;
    };
    dailyStats: Array<{
        date: string;
        applications: number;
        approved: number;
        revenue: number;
    }>;
    plantTypeDistribution: Array<{
        name: string;
        value: number;
        color: string;
    }>;
    topProvinces: Array<{
        province: string;
        count: number;
        percentage: number;
    }>;
}

interface _AnalyticsApiResponse {
    success?: boolean;
    data?: AnalyticsData;
    error?: string;
}

export default function AnalyticsPage() {
    const { dict } = useLanguage();
    const aDict = dict.provider?.analytics;
    const [period, setPeriod] = useState<string>("30");
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchAnalytics = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await apiClient.get<AnalyticsData>(`/reports/analytics?period=${period}`);

            if (result.success) {
                setData(result.data ?? null);
                return;
            }
            setData(null);
            setError(result?.error || aDict?.errorMessage || "ไม่สามารถโหลดข้อมูลวิเคราะห์ได้");
        } catch (error: unknown) {
            console.error("Error fetching analytics:", error);
            setData(null);
            setError(aDict?.errorRetry || "ไม่สามารถโหลดข้อมูลวิเคราะห์ได้ กรุณาลองใหม่");
        } finally {
            setIsLoading(false);
        }
    }, [period, aDict?.errorMessage, aDict?.errorRetry]);

    useEffect(() => {
        void fetchAnalytics();
    }, [fetchAnalytics]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat("th-TH", {
            style: "currency",
            currency: "THB",
            minimumFractionDigits: 0
        }).format(amount);
    };

    const metrics = useMemo(() => {
        if (!data) return [];
        return [
            { label: aDict?.metrics?.totalApps || 'Total Apps', value: String(data.applications.total), icon: '📄' },
            { label: aDict?.metrics?.approved || 'Approved', value: String(data.applications.approved), icon: '✅' },
            { label: aDict?.metrics?.revenue || 'Revenue', value: `฿${(data.financial.revenue / 1000).toFixed(1)}k`, icon: '💰' },
            { label: aDict?.metrics?.farmers || 'Farmers', value: String(data.users.totalApplicants), icon: '👨‍🌾' },
        ];
    }, [data, aDict?.metrics]);

    if (isLoading) {
        return (
            <ProviderLayout title={aDict?.pageTitle || 'Analytics & Reports'}>
                <div className="flex h-[60vh] items-center justify-center">
                    <Spinner size="lg" />
                </div>
            </ProviderLayout>
        );
    }

    if (!data) {
        return (
            <ProviderLayout title={aDict?.pageTitle || 'Analytics & Reports'}>
                <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
                    <p className="font-medium text-muted-foreground">{error || aDict?.errorMessage || "ไม่สามารถโหลดข้อมูลวิเคราะห์ได้"}</p>
                    <Button onClick={fetchAnalytics} className="rounded-xl">{aDict?.retry || 'Retry'}</Button>
                </div>
            </ProviderLayout>
        );
    }

    return (
        <ProviderLayout title={aDict?.pageTitle || 'Analytics & Reports'} subtitle={aDict?.pageSubtitle || 'System performance and statistics'}>
            <div className="animate-fade-in space-y-8">

                <SummaryHeader
                    eyebrow={aDict?.eyebrow || 'Provider Insights'}
                    title={aDict?.heading || 'System Analytics Overview'}
                    description={(aDict?.description || 'Comprehensive overview of system performance, application trends, and financial metrics for the last {days} days.').replace('{days}', period)}
                    metrics={metrics}
                    actions={
                        <div className="flex gap-2">
                            <Select value={period} onValueChange={setPeriod}>
                                <SelectTrigger className="h-9 w-[160px]">
                                    <Calendar className="mr-2 h-4 w-4" />
                                    <SelectValue placeholder={aDict?.periods?.placeholder || 'Period'} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="7">{aDict?.periods?.last7 || 'Last 7 days'}</SelectItem>
                                    <SelectItem value="30">{aDict?.periods?.last30 || 'Last 30 days'}</SelectItem>
                                    <SelectItem value="90">{aDict?.periods?.last90 || 'Last 90 days'}</SelectItem>
                                    <SelectItem value="365">{aDict?.periods?.lastYear || 'Last year'}</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9"
                                onClick={fetchAnalytics}
                            >
                                <RefreshCcw className="mr-2 h-4 w-4" /> {aDict?.refresh || 'Refresh'}
                            </Button>
                            <Button
                                asChild
                                variant="outline"
                                size="sm"
                                className="h-9"
                            >
                                <Link href="/provider/analytics/work">
                                    <BarChart3 className="mr-2 h-4 w-4" /> {aDict?.workKpis || 'Work KPIs'}
                                </Link>
                            </Button>
                        </div>
                    }
                />

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                    <StatCard
                        label={aDict?.cards?.totalApplications || 'Total Applications'}
                        value={data.applications.total}
                        trend={data.applications.trend}
                        icon={FileCheck}
                        subtext={`${data.applications.new} ${aDict?.cards?.newSuffix || 'new'}, ${data.applications.renewal} ${aDict?.cards?.renewalsSuffix || 'renewals'}`}
                    />
                    <StatCard
                        label={aDict?.cards?.totalRevenue || 'Total Revenue'}
                        value={formatCurrency(data.financial.revenue)}
                        trend={data.financial.trend}
                        icon={Coins}
                        subtext={`${aDict?.cards?.pendingPrefix || 'Pending:'} ${formatCurrency(data.financial.pending)}`}
                    />
                    <StatCard
                        label={aDict?.cards?.activeFarmers || 'Active Farmers'}
                        value={data.users.totalApplicants}
                        trend={data.users.trend}
                        icon={Users}
                        subtext={`${data.users.newApplicants} ${aDict?.cards?.newThisPeriod || 'new this period'}`}
                    />
                    <StatCard
                        label={aDict?.cards?.certificatesIssued || 'Certificates Issued'}
                        value={data.users.activeCertificates}
                        icon={BarChart3}
                        subtext={`${data.applications.approved} ${aDict?.cards?.approvedTotal || 'approved total'}`}
                    />
                </div>

                <Tabs defaultValue="overview" className="w-full">
                    <TabsList className="h-11 rounded-xl bg-muted/50 p-1">
                        <TabsTrigger value="overview" className="rounded-lg px-6 py-2">{aDict?.tabs?.overview || 'Overview'}</TabsTrigger>
                        <TabsTrigger value="performance" className="rounded-lg px-6 py-2">{aDict?.tabs?.performance || 'Performance'}</TabsTrigger>
                        <TabsTrigger value="geographic" className="rounded-lg px-6 py-2">{aDict?.tabs?.geographic || 'Geographic'}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="animate-fade-in mt-6 space-y-6">
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                            <Card className="overflow-hidden rounded-lg border-border bg-card shadow-none lg:col-span-2">
                                <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
                                            <TrendingUp className="h-4 w-4 text-primary" />
                                            {aDict?.charts?.trends || 'Application Trends'}
                                        </CardTitle>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <Table>
                                        {/* light header: explicit text color — the primitive's default
                                            text-primary-foreground (white) must not survive on bg-muted/10 */}
                                        <TableHeader className="bg-muted/10 text-muted-foreground">
                                            <TableRow>
                                                <TableHead className="pl-6">{aDict?.charts?.date || 'Date'}</TableHead>
                                                <TableHead>{aDict?.charts?.applications || 'Applications'}</TableHead>
                                                <TableHead>{aDict?.charts?.approved || 'Approved'}</TableHead>
                                                <TableHead className="pr-6 text-right">{aDict?.charts?.revenue || 'Revenue'}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {data.dailyStats.slice(-7).map((day, i) => (
                                                <TableRow key={i} className="transition-colors hover:bg-muted/30">
                                                    <TableCell className="py-4 pl-6 font-medium">{day.date}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" tone="primary" className="rounded-md">
                                                            {day.applications}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" tone="success" className="rounded-md">
                                                            {day.approved}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="pr-6 text-right tabular-nums">{formatCurrency(day.revenue)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>

                            <Card className="rounded-lg border-border bg-card shadow-none">
                                <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
                                    <CardTitle className="text-sm font-medium text-foreground">
                                        {aDict?.charts?.plantTypeDist || 'Plant Type Distribution'}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-6 p-6">
                                    {data.plantTypeDistribution.map((plant) => (
                                        <div key={plant.name} className="space-y-2">
                                            <div className="flex items-end justify-between">
                                                <p className="text-sm text-foreground">{plant.name}</p>
                                                <p className="text-xs font-medium text-muted-foreground">{plant.value} {aDict?.charts?.units || 'units'}</p>
                                            </div>
                                            <Progress
                                                value={(plant.value / data.applications.total) * 100}
                                                className="h-2 rounded-full"
                                                indicatorClassName="bg-primary"
                                            />
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    <TabsContent value="performance" className="animate-fade-in mt-6">
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                            <PerformanceCard
                                label={aDict?.performance?.avgProcessing || 'Avg. Processing'}
                                value={`${data.performance.avgProcessingDays} ${aDict?.performance?.days || 'Days'}`}
                                target={aDict?.performance?.targetProcessing || 'Target: 14 days'}
                                percentage={(data.performance.avgProcessingDays / 30) * 100}
                            />
                            <PerformanceCard
                                label={aDict?.performance?.avgAudit || 'Avg. Audit Time'}
                                value={`${data.performance.avgAuditDays} ${aDict?.performance?.days || 'Days'}`}
                                target={aDict?.performance?.targetAudit || 'Target: 3 days'}
                                percentage={(data.performance.avgAuditDays / 7) * 100}
                            />
                            <PerformanceCard
                                label={aDict?.performance?.satisfaction || 'Satisfaction'}
                                value={`${data.performance.satisfactionRate}/5.0`}
                                target={aDict?.performance?.userRating || 'User Rating'}
                                percentage={(data.performance.satisfactionRate / 5) * 100}
                                isGold
                            />
                        </div>
                    </TabsContent>

                    <TabsContent value="geographic" className="animate-fade-in mt-6">
                        <Card className="overflow-hidden rounded-lg border-border bg-card shadow-none">
                            <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
                                <CardTitle className="text-sm font-medium text-foreground">
                                    {aDict?.charts?.topProvinces || 'Top Provinces by Volume'}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="pl-6">{aDict?.charts?.province || 'Province'}</TableHead>
                                            <TableHead>{aDict?.charts?.applications || 'Applications'}</TableHead>
                                            <TableHead>{aDict?.charts?.marketShare || 'Market Share'}</TableHead>
                                            <TableHead className="pr-6">{aDict?.charts?.distribution || 'Distribution'}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.topProvinces.map((prov) => (
                                            <TableRow key={prov.province} className="transition-colors hover:bg-muted/30">
                                                <TableCell className="py-4 pl-6 font-medium">{prov.province}</TableCell>
                                                <TableCell className="font-medium">{prov.count}</TableCell>
                                                <TableCell>
                                                    <Badge tone="neutral" className="rounded-md">
                                                        {prov.percentage}%
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="w-1/3 pr-6">
                                                    <Progress value={prov.percentage} className="h-1.5" indicatorClassName="bg-primary" />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </ProviderLayout>
    );
}

function StatCard({ label, value, trend, icon: Icon, subtext }: { label: string; value: string | number; trend?: number; icon: React.ComponentType<{ className?: string | undefined }>; subtext?: string }) {
    const isPositive = (trend ?? 0) >= 0;

    return (
        <Card className="rounded-lg border-border bg-card shadow-none">
            <CardContent className="p-5">
                <div className="mb-3 flex items-start justify-between">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    {trend !== undefined && (
                        <div className={cn(
                            "flex items-center gap-0.5 text-xs font-medium",
                            isPositive ? "text-leaf-700" : "text-destructive"
                        )}>
                            {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(trend)}%
                        </div>
                    )}
                </div>
                <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
                    {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
                </div>
            </CardContent>
        </Card>
    );
}

function PerformanceCard({ label, value, target, percentage, isGold: _isGold }: { label: string; value: string; target: string; percentage: number; isGold?: boolean }) {
    return (
        <Card className="rounded-lg border-border bg-card shadow-none">
            <CardContent className="space-y-3 p-5">
                <h4 className="text-sm font-medium text-muted-foreground">{label}</h4>
                <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
                <Progress value={Math.min(percentage, 100)} className="h-1.5" indicatorClassName="bg-primary" />
                <p className="text-xs text-muted-foreground">{target}</p>
            </CardContent>
        </Card>
    );
}
