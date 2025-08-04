interface Metrics {
  requests: {
    total: number;
    success: number;
    errors: number;
    byStatus: Record<number, number>;
  };
  downloads: {
    total: number;
    success: number;
    failed: number;
    byPlatform: Record<string, number>;
  };
  performance: {
    averageResponseTime: number;
    responseTimeHistory: number[];
  };
  system: {
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
  };
}

class MetricsCollector {
  private metrics: Metrics = {
    requests: {
      total: 0,
      success: 0,
      errors: 0,
      byStatus: {}
    },
    downloads: {
      total: 0,
      success: 0,
      failed: 0,
      byPlatform: {}
    },
    performance: {
      averageResponseTime: 0,
      responseTimeHistory: []
    },
    system: {
      uptime: 0,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    }
  };

  private startTime = Date.now();

  recordRequest(statusCode: number, responseTime: number) {
    this.metrics.requests.total++;
    
    if (statusCode >= 200 && statusCode < 400) {
      this.metrics.requests.success++;
    } else {
      this.metrics.requests.errors++;
    }

    this.metrics.requests.byStatus[statusCode] = 
      (this.metrics.requests.byStatus[statusCode] || 0) + 1;

    // Record response time
    this.metrics.performance.responseTimeHistory.push(responseTime);
    
    // Keep only last 1000 response times
    if (this.metrics.performance.responseTimeHistory.length > 1000) {
      this.metrics.performance.responseTimeHistory.shift();
    }

    // Calculate average response time
    const sum = this.metrics.performance.responseTimeHistory.reduce((a, b) => a + b, 0);
    this.metrics.performance.averageResponseTime = 
      sum / this.metrics.performance.responseTimeHistory.length;
  }

  recordDownload(platform: string, success: boolean) {
    this.metrics.downloads.total++;
    
    if (success) {
      this.metrics.downloads.success++;
    } else {
      this.metrics.downloads.failed++;
    }

    this.metrics.downloads.byPlatform[platform] = 
      (this.metrics.downloads.byPlatform[platform] || 0) + 1;
  }

  updateSystemMetrics() {
    this.metrics.system.uptime = Date.now() - this.startTime;
    this.metrics.system.memoryUsage = process.memoryUsage();
    this.metrics.system.cpuUsage = process.cpuUsage();
  }

  getMetrics(): Metrics {
    this.updateSystemMetrics();
    return { ...this.metrics };
  }

  reset() {
    this.metrics = {
      requests: {
        total: 0,
        success: 0,
        errors: 0,
        byStatus: {}
      },
      downloads: {
        total: 0,
        success: 0,
        failed: 0,
        byPlatform: {}
      },
      performance: {
        averageResponseTime: 0,
        responseTimeHistory: []
      },
      system: {
        uptime: 0,
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage()
      }
    };
    this.startTime = Date.now();
  }
}

export const metricsCollector = new MetricsCollector();

// Metrics endpoint handler
export const getMetricsHandler = () => {
  return metricsCollector.getMetrics();
};
