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

function effect(fn) {
    const effectFn = () => {
        cleanup(effectFn)
        activeEffect = effectFn
        effectStack.push(effectFn)
        fn()
        effectStack.pop()
        activeEffect = effectStack[effectStack.length - 1]
    }
    effectFn.deps = []
    effectFn()
}

function track(target, key) {
    if (!activeEffect) return

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
function trigger(target, key) {
    const depsMap = bucket.get(target)
    if (!depsMap) return
    const effects = depsMap.get(key)

    const effectsToRun = new Set(effects)
    effectsToRun.forEach(fn => fn())
}


const data = { foo: true, bar: true }

const obj = new Proxy(data, {
    get(target, key) {
        track(target, key)
        return target[key]
    },
    set(target, key, newVal) {
        target[key] = newVal
        trigger(target, key)
    }
})

let temp1, temp2

effect(function() {
    console.log('effectFn1执行');

    effect(function() {
        console.log('effectFn2执行')
        temp2 = obj.bar
    })
    temp1 = obj.foo
})

obj.foo = false