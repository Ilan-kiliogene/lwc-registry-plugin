import { z } from 'zod';
export declare const DependencySchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodString;
    version: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    type: string;
    version: string;
}, {
    name: string;
    type: string;
    version: string;
}>;
export declare const versionSchema: z.ZodObject<{
    version: z.ZodString;
    description: z.ZodString;
    hash: z.ZodString;
    staticresources: z.ZodArray<z.ZodString, "many">;
    registryDependencies: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodString;
        version: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: string;
        version: string;
    }, {
        name: string;
        type: string;
        version: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    version: string;
    description: string;
    hash: string;
    staticresources: string[];
    registryDependencies: {
        name: string;
        type: string;
        version: string;
    }[];
}, {
    version: string;
    description: string;
    hash: string;
    staticresources: string[];
    registryDependencies: {
        name: string;
        type: string;
        version: string;
    }[];
}>;
export declare const entrySchema: z.ZodObject<{
    name: z.ZodString;
    versions: z.ZodArray<z.ZodObject<{
        version: z.ZodString;
        description: z.ZodString;
        hash: z.ZodString;
        staticresources: z.ZodArray<z.ZodString, "many">;
        registryDependencies: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            type: z.ZodString;
            version: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            type: string;
            version: string;
        }, {
            name: string;
            type: string;
            version: string;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        version: string;
        description: string;
        hash: string;
        staticresources: string[];
        registryDependencies: {
            name: string;
            type: string;
            version: string;
        }[];
    }, {
        version: string;
        description: string;
        hash: string;
        staticresources: string[];
        registryDependencies: {
            name: string;
            type: string;
            version: string;
        }[];
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    name: string;
    versions: {
        version: string;
        description: string;
        hash: string;
        staticresources: string[];
        registryDependencies: {
            name: string;
            type: string;
            version: string;
        }[];
    }[];
}, {
    name: string;
    versions: {
        version: string;
        description: string;
        hash: string;
        staticresources: string[];
        registryDependencies: {
            name: string;
            type: string;
            version: string;
        }[];
    }[];
}>;
export declare const registrySchema: z.ZodObject<{
    component: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        versions: z.ZodArray<z.ZodObject<{
            version: z.ZodString;
            description: z.ZodString;
            hash: z.ZodString;
            staticresources: z.ZodArray<z.ZodString, "many">;
            registryDependencies: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                type: z.ZodString;
                version: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
                type: string;
                version: string;
            }, {
                name: string;
                type: string;
                version: string;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }, {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        name: string;
        versions: {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }[];
    }, {
        name: string;
        versions: {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }[];
    }>, "many">;
    class: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        versions: z.ZodArray<z.ZodObject<{
            version: z.ZodString;
            description: z.ZodString;
            hash: z.ZodString;
            staticresources: z.ZodArray<z.ZodString, "many">;
            registryDependencies: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                type: z.ZodString;
                version: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
                type: string;
                version: string;
            }, {
                name: string;
                type: string;
                version: string;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }, {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        name: string;
        versions: {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }[];
    }, {
        name: string;
        versions: {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }[];
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    component: {
        name: string;
        versions: {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }[];
    }[];
    class: {
        name: string;
        versions: {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }[];
    }[];
}, {
    component: {
        name: string;
        versions: {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }[];
    }[];
    class: {
        name: string;
        versions: {
            version: string;
            description: string;
            hash: string;
            staticresources: string[];
            registryDependencies: {
                name: string;
                type: string;
                version: string;
            }[];
        }[];
    }[];
}>;
export type Dependency = z.infer<typeof DependencySchema>;
export type ComponentOrClassVersion = z.infer<typeof versionSchema>;
export type ComponentOrClassEntry = z.infer<typeof entrySchema>;
export type Registry = z.infer<typeof registrySchema>;
export type ItemType = 'component' | 'class';
export type RegistryDep = Readonly<{
    name: string;
    type: ItemType;
    dependencies: Array<{
        name: string;
        type: ItemType;
    }>;
    staticresources: string[];
    version?: string;
}>;
