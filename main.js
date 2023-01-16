// const { default: MyComponent } = require("./components/mycomponent")

// const vnode = {
//     tag: MyComponent
// }

// function renderer(vnode, container) {
//     if (typeof vnode.tag === 'string') {
//         mountElement(vnode, container)
//     } else if (typeof vnode.tag === 'object') {
//         console.log(vnode.tag)
//         mountComponent(vnode, container)
//     }
// }

// function mountElement(vnode, container) {
//     const el = document.createElement(vnode.tag)
//     for (const key in vnode.props) {
//         if (/^on/.test(key)) {
//             el.addEventListener(
//                 key.substr(2).toLowerCase(),
//                 vnode.props[key]
//             )
//         }
//     }
//     if (typeof vnode.children === 'string') {
//         el.appendChild(document.createTextNode(vnode.children))
//     } else if (Array.isArray(vnode.children)) {
//         vnode.children.forEach(child => renderer(child, el))
//     }

//     container.appendChild(el)
// }

// function mountComponent(vnode, container) {
//     const subtree = vnode.tag.render()
//     console.log("####", subtree)
//     renderer(subtree, container)
// }

// renderer(vnode, document.body)

let activeEffect
const effectStack = []

const bucket = new WeakMap()

function cleanup(effectFn) {
    for (let i = 0; i < effectFn.deps.length; i++) {
        const deps = effectFn.deps[i]
        deps.delete(effectFn)
    }
    effectFn.deps.length = 0
}

function effect(fn, options = {}) {
    const effectFn = () => {
        cleanup(effectFn)
        activeEffect = effectFn
        effectStack.push(effectFn)
        const res = fn()
        effectStack.pop()
        activeEffect = effectStack[effectStack.length - 1]
        return res
    }
    effectFn.options = options
    effectFn.deps = []
    if (!options.lazy) {
        effectFn()
    }
    return effectFn
}

const TriggerType = {
    SET: 'SET',
    ADD: 'ADD'
}
function track(target, key) {
    if (!activeEffect || !shouldTrack) return

    let depsMap = bucket.get(target)
    if (!depsMap) {
        bucket.set(target, (depsMap = new Map()))
    }
    let deps = depsMap.get(key)
    if (!deps) {
        depsMap.set(key, (deps = new Set()))
    }
    deps.add(activeEffect)
    activeEffect.deps.push(deps)
}
function trigger(target, key, type, newVal) {
    const depsMap = bucket.get(target)
    if (!depsMap) return
    const effects = depsMap.get(key)

    const effectsToRun = new Set()
    effects && effects.forEach(effectFn => {
        if (effectFn !== activeEffect) {
            effectsToRun.add(effectFn)
        }
    })
    if (type === 'ADD' || type === 'DELETE' ||
        (type === 'SET' && Object.prototype.toString.call(target) === '[object Map]')) {
        const iterateEffects = depsMap.get(ITERATE_KEY)
        iterateEffects && iterateEffects.forEach(effectFn => {
            if (effectFn !== activeEffect) {
                effectsToRun.add(effectFn)
            }
        })
    }
    if (type === 'ADD' && Array.isArray(target)) {
        const lengthEffects = depsMap.get('length')
        lengthEffects && lengthEffects.forEach(effectFn => {
            if (effectFn !== activeEffect) {
                effectsToRun.add(effectFn)
            }
        })
    }
    if (Array.isArray(target) && key === 'length') {
        depsMap.forEach((effects, key) => {
            if (key > newVal) {
                effects.forEach(effectFn => {
                    if (effectFn !== activeEffect) {
                       effectsToRun.add(effectFn)
                    }
                })
            }
        })
    }
    effectsToRun.forEach(effectFn => {
        if (effectFn.options.scheduler) {
            effectFn.options.scheduler(effectFn)
        } else {
            effectFn()
        }
    })
}

function computed(getter) {
    let value
    let dirty = true

    const effectFn = effect(getter, {
        lazy: true,
        scheduler() {
            if (!dirty) {
                dirty = true
                trigger(obj, 'value')
            }
        }
    })

    const obj = {
        get value() {
            if (dirty) {
                value = effectFn()
                dirty = false
            }
            track(obj, 'value')
            return value
        }
    }
    return obj
}

function watch(source, cb, options = {}) {
    let getter
    if (typeof source === 'function') {
        getter = source
    } else {
        getter = () => traverse(source)
    }
    let oldValue, newValue

    let cleanup
    function onInvalidate(fn) {
        cleanup = fn
    }

    const job = () => {
        newValue = effectFn()
        if (cleanup) {
            cleanup()
        }
        cb(newValue, oldValue, onInvalidate)
        oldValue = newValue
    }

    const effectFn = effect(
        () => getter(),
        {
            lazy: true,
            scheduler: () => {
                if (options.fulsh === 'post') {
                    const p = Promise.resolve()
                    p.then(job)
                } else {
                    job()
                }
            }
        }
    )

    if (options.immediate) {
        job()
    } else {
        oldValue = effectFn()
    }
}

function traverse(value, seen = new Set()) {
    if (typeof value !== 'object' || value === null || seen.add(value)) return
    seen.add(value)
    for (const k in value) {
        traverse(value[k], seen)
    }
    return value
}

const jobQueue = new Set()
const p = Promise.resolve()

let isFlushing = false
function flushJob() {
    if (isFlushing) return
    isFlushing = true
    p.then(() => {
        jobQueue.forEach(job => job())
    }).finally(() => {
        isFlushing = false
    })
}


const ITERATE_KEY = Symbol()

const originMethod = Array.prototype.includes
const arrayInstrumentations = {
    includes: function(...args) { 
        let res = originMethod.apply(this, args)

        if (res === false) {
            res = originMethod.apply(this.raw, args)
        }
        return res
    }
}
const mutableInstrumentations = {
    get(key) {
        const target = this.raw
        const had = target.has(key)
        track(target, key)
        if (had) {
            const res = target.get(key)
            return typeof res === 'object' ? reactive(res) : res
        }
    },
    set(key, value) {
        const target = this.raw
        const had = target.has(key)
        const oldValue = target.get(key)
        const rawValue = value.raw || value
        target.set(key, rawValue)
        if (!had) {
            trigger(target, key, 'ADD')
        } else if (oldValue !== value || (oldValue === oldValue && value === value)) {
            trigger(target, key, 'SET')
        }
    },
    add(key) {
        const target = this.raw
        const hadKey = target.has(key)
        const res = target.add(key)
        if (!hadKey) {
            trigger(target, key, 'ADD')
        }
        return res
    },
    delete (key) {
        const target = this.raw
        const hadKey = target.has(key)
        const res = target.delete(key)
        if (hadKey) {
            trigger(target, key, 'DELETE')
        }
        return res
    },
    forEach(callback) {
        const warp = (val) => typeof val === 'object' ? reactive(val) : val
        const target = this.raw
        track(target, ITERATE_KEY)
        target.forEach((v, k) => {
            callback.call(thisArg, warp(v), warp(k), this)
        })
    }
}

let shouldTrack = true
;['push','pop','shift','unshift','splice'].forEach(method => {
    const originMethod = Array.prototype[method]
    arrayInstrumentations[method] = function(...args) {
        shouldTrack = false
        let res = originMethod.apply(this, args)
        shouldTrack = true
        return res
    }
})

const reactiveMap = new Map()

function reactive(obj) {
    const existionProxy = reactiveMap.get(obj)
    if (existionProxy) return existionProxy

    const proxy = createReactive(obj)
    reactiveMap.set(obj, proxy)
    return proxy
}

function createReactive(obj, isShallow = false, isReadonly = false) {
    return new Proxy(obj, {
        get(target, key, receiver) {
            if (key === 'raw') {
                return target
            }
            if (key === 'size') {
                track(target, ITERATE_KEY)
                return Reflect.get(target, key, target)
            }
            return mutableInstrumentations[key]

            if (Array.isArray(target) && arrayInstrumentations.hasOwnProperty(key)) {
                return Reflect.get(arrayInstrumentations, key, receiver)
            }
            if (!isReadonly && typeof key !== 'symbol') {
                track(target, key)
            }
            const res = Reflect.get(target, key, receiver)
            if(isShallow) {
                return res
            }
            if (typeof res === 'object' && res !== null) {
                return isReadonly ? readonly(res): reactive(res)
            }
            return res
        },
        has(target, key) {
            track(target, key)
            return Reflect.has(target, key)
        },
        ownKeys(target) {
            track(target, Array.isArray(target) ? 'length' : ITERATE_KEY)
            return Reflect.ownKeys(target)
        },
        set(target, key, newVal, receiver) {
            if (isReadonly) {
                console.warn(`属性${key}是只读的`)
                return true
            }
            const oldVal = target[key]
            const type =  Array.isArray(target)
                ? Number(key) < target.length ? 'SET' : 'ADD'
                : Object.prototype.hasOwnProperty.call(target, key) ? 'SET' : 'ADD'
            const res = Reflect.set(target, key, newVal, receiver)
            if (target === receiver.raw) {
                if (oldVal !== newVal && (oldVal === oldVal || newVal === newVal)) {
                    trigger(target, key, type, newVal)
                }
            }
            return res
        },
        deleteProperty(target, key) {
            if (isReadonly) {
                console.warn(`属性${key}是只读的`)
                return true
            }
            const hadKey = Object.prototype.hasOwnProperty.call(target, key)
            const res = Reflect.deleteProperty(target, key)

            if (res && hadKey) {
                trigger(target, key, 'DELETE')
            }
            return res
        }
    })
}

function shallowReactive(obj) {
    return createReactive(obj, true)
}

function readonly(obj) { 
    return createReactive(obj, false, true)
}

function shallowReadonly(obj) {
    return createReactive(obj, true, true)
}

const p1 = reactive(new Map([
    [{key:1}, {value: 1}]
]))

effect(() => {
    p1.forEach(function(value, key) {
        console.log(value)
        console.log(key)
    })
})

p1.set({key: 2}, {value: 2})