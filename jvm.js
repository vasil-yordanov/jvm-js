var runtime;

function MethodProxy(class_name, method, constant_pool, obj, args) {
//	console.log('-----> '+class_name+'->'+method.name+method.descriptor);
  function getValueCategory(value) {
    return value.type === "D" || value.type === "J" ? 2 : 1;
  }

  function getArgumentsFromDescriptor(descriptor) {
    var i = descriptor.indexOf("("), j = descriptor.indexOf(")");
    var regexp = /\[*(L[^;]*;|[BCDFIJSZ])/g;
    var args = [], m, argsString = descriptor.substring(i + 1, j);
    while ((m = regexp.exec(argsString)) !== null) {
      args.push(m[0]);
    }
    return args;
  }

  function getArgumentsCountFromDescriptor(descriptor) {
    return getArgumentsFromDescriptor(descriptor).length;
  }

  function hasReturnValueFromDescriptor(descriptor) {
    return descriptor.indexOf(")V") < 0;
  }

  var methodCode = method.find_attribute("Code");
  var isNative = "ACC_NATIVE" in method.access_flags;
  
  var exceptionTable = (methodCode == null) ? null : methodCode.exception_table;
  var isStatic = "ACC_STATIC" in method.access_flags;
  var argumentDescriptors = getArgumentsFromDescriptor(method.descriptor);

  var bytecode = (methodCode == null) ? null : methodCode.code;
  var stack = [];
  var locals = [];
  if (!isStatic) {
    locals.push(obj);
  }
  for (var i = 0; i < argumentDescriptors.length; i++) {    
    locals.push(args[i]);
    if (getValueCategory(argumentDescriptors[i]) === 2) {
      locals.push(args[i]);
    }
  }

  var pc = 0, lastKnownPc;
  var wideFound = false;

  if (!isNative) {
	  this.execute = function() {
		  var limit = 30000;
		  while (this.step()) {
			if (--limit < 0) { throw "too many steps"; }
		  }
		  return stack.pop();
	  };
  } else {
    this.execute = function(){
		var exec = getNative(class_name, method.name);
		if (exec == null) {
			if (class_name === "java/lang/Throwable" ||
			class_name === "java/lang/Object") {
				throw "Can not find native method " + method.name + ", for class "+class_name;
			} 
			var ex = runtime.newexception("java/lang/UnsatisfiedLinkError");
			throw new MethodExecutionException("Exception", ex);
		} else {
			return exec(null,obj);
		}
	}
  }
   
  this.step = function() {
//    var raiseExceptionCookie = {};

    function validateArrayref(arrayref) {
      if (arrayref === null) {
        raiseException("java/lang/NullPointerException");
      } 
    }

    function validateArrayrefAndIndex(arrayref, index) {
      validateArrayref(arrayref);
      if (!(index.value >= 0 && index.value < arrayref.length)) {
        raiseException("java/lang/ArrayIndexOutOfBoundsException");
      }
    }

    function raiseException(typeName) {
      var ex = runtime.newexception(typeName);
	  throw new MethodExecutionException("Exception", ex);
      //processThrow(ex);
    }

    //function processThrow(objectref) {
	function processThrow(e) {
		if (!(e instanceof MethodExecutionException)){
			throw "Can not processThrow exception type is not expected";
		}
	var objectref = e.nativeException;
      // check table
      var handler;
      for (var i = 0, l = exceptionTable.length; i < l; ++i) {
        if (exceptionTable[i].start_pc <= lastKnownPc && lastKnownPc < exceptionTable[i].end_pc) {
          if (!exceptionTable[i].catch_type || instanceOf(objectref, exceptionTable[i].catch_type)) {
            handler = exceptionTable[i];
            break;
          }
        }
      }
      if (handler) {
        stack.push(objectref);
        pc = exceptionTable[i].handler_pc;
//        throw raiseExceptionCookie;
      } else {
		throw e;
//        if (!("stackTrace" in objectref)) {
//          objectref.stackTrace = [];
//        }
//        objectref.stackTrace.push({method: method, pc: lastKnownPc});
        //throw new MethodExecutionException("Exception", objectref);
      }
    }

    function validateNonNull(objectref) {
      if (objectref === null) {
        raiseException("java/lang/NullPointerException");
      }
    }

    function convertForStore(value, oldValue) {
      if (typeof value !== "object" || typeof oldValue !== "object" || 
        !("type" in value) || !("value" in value)) { 
        return value;
      }
      if (value.type === oldValue.type) {
        return value;
      } else if (value.type === "J") {
        return {value:value.value.toNumeric(), type:oldValue.type};
      } else if (oldValue.type === "J") {
        return {value:LongValue.fromNumeric(value.value), type:oldValue.type};
      } else {
        return {value:value.value, type:oldValue.type};
      }
    }

    function getDefaultValue(atype) {
      switch (atype) {
      case 4: // T_BOOLEAN
        return { value: 0, type: "Z" };
      case 5: // T_CHAR
        return { value: 0, type: "C" };
      case 6: // T_FLOAT
        return { value: 0, type: "F" };
      case 7: // T_DOUBLE
        return { value: 0, type: "D" };
      case 8: // T_BYTE
        return { value: 0, type: "B" };
      case 9: // T_SHORT
        return { value: 0, type: "S" };
      case 10: // T_INT
        return { value: 0, type: "I" };
      case 11: // T_LONG
        return { value: LongValue.Zero, type: "J" };
      }
      return null;
    }

    function createAArray(counts, class_) {
      var ar = [];
      for (var i = 0, l = counts[0]; i < l; ++i) {
        ar.push( counts.length <= 1 ? null :
         createAArray(counts.slice(1, counts.length), class_) );
      }
      return ar;
    }

    function createArray(count, atype) {
      var ar = [], defaultValue = getDefaultValue(atype);
      for (var i = 0, l = count.value; i < l; ++i) {
        ar.push(defaultValue);
      }
      return ar;
    }

    function checkCast(objectref, type) {
      if (!runtime.instanceof_(objectref, type)) {
        raiseException("java/lang/ClassCastException");
      }
    }

    function instanceOf(objectref, type) {
      return runtime.instanceof_(objectref, type) ? 1 : 0;
    }
	function debugLocals(){
		for (var localIdx in locals) {
			var local = locals[localIdx];
			if (local instanceof Object && '$factory' in local) {
				console.debug('  local_'+localIdx+'='+local.$factory.className);
			} else {
				console.debug('  local_'+localIdx+'='+local);
			}
		}
	}
	function debugStack(){
		for (var stackIdx in stack) {
			var st = stack[stackIdx];
			if (st instanceof Object && '$factory' in st) {
				console.debug('  stack_'+stackIdx+'='+st.$factory.className);
			} else {
				console.debug('  stack_'+stackIdx+'='+st);
			}
		}
	}
    lastKnownPc = pc;

      var op = bytecode[pc++];
      var jumpToAddress = null;	  
      console.debug("method: "+class_name+"->"+method.name+method.descriptor+", OP="+ op + "; CP=" + (pc-1)+ "; "+jvm_instr[op]);
	  debugLocals();
	  debugStack();
	try { 
switch (op) {
case 0: // (0x00) nop
  break;
case 1: // (0x01) aconst_null
  stack.push(null);
  break;
case 2: // (0x02) iconst_m1
case 3: // (0x03) iconst_0
case 4: // (0x04) iconst_1
case 5: // (0x05) iconst_2
case 6: // (0x06) iconst_3
case 7: // (0x07) iconst_4
case 8: // (0x08) iconst_5
  var n = op - 3;
  stack.push({value: n, type: "I"});
  break;
case 9: // (0x09) lconst_0
case 10: // (0x0a) lconst_1
  var n = op - 9;
  stack.push({value: new LongValue([0,0,0,0,0,0,0,n]), type: "J"});
  break;
case 11: // (0x0b) fconst_0
case 12: // (0x0c) fconst_1
case 13: // (0x0d) fconst_2
  var n = op - 11;
  stack.push({value: n, type: "F"});
  break;
case 14: // (0x0e) dconst_0
case 15: // (0x0f) dconst_1
  var n = op - 14;
  stack.push({value: n, type: "D"});
  break;
case 16: // (0x10) bipush
  var n = bytecode[pc++];
  stack.push({value: n > 0x80 ? n - 0x100 : n, type: "I"});
  break;
case 17: // (0x11) sipush
  var n = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  stack.push({value: n > 0x8000 ? n - 0x10000 : n, type: "I"});
  break;
case 18: // (0x12) ldc
  var index = bytecode[pc++];
  var const_ = constant_pool[index];
  if ("value_type" in const_) {
    stack.push({value: const_.value, type: const_.value_type});
  } else {
    stack.push(const_.value);
  }
  break;
case 19: // (0x13) ldc_w
case 20: // (0x14) ldc2_w
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var const_ = constant_pool[index];
  if ("value_type" in const_) {
    stack.push({value: const_.value, type: const_.value_type});
  } else {
    stack.push(const_.value);
  }
  break;
case 21: // (0x15) iload
case 22: // (0x16) lload
case 23: // (0x17) fload
case 24: // (0x18) dload
case 25: // (0x19) aload
  var index;
  if (wideFound) {
    wideFound = false;
    index = (bytecode[pc] << 8) | bytecode[pc + 1];
    pc += 2;
  } else {
    index = bytecode[pc++];
  }
  stack.push(locals[index]);
  break;
case 26: // (0x1a) iload_0
case 30: // (0x1e) lload_0
case 34: // (0x22) fload_0
case 38: // (0x26) dload_0
case 42: // (0x2a) aload_0
  stack.push(locals[0]);
  break;
case 27: // (0x1b) iload_1
case 31: // (0x1f) lload_1
case 35: // (0x23) fload_1
case 39: // (0x27) dload_1
case 43: // (0x2b) aload_1
  stack.push(locals[1]);
  break;
case 32: // (0x20) lload_2
case 28: // (0x1c) iload_2
case 36: // (0x24) fload_2
case 40: // (0x28) dload_2
case 44: // (0x2c) aload_2
  stack.push(locals[2]);
  break;
case 29: // (0x1d) iload_3
case 33: // (0x21) lload_3
case 37: // (0x25) fload_3
case 41: // (0x29) dload_3
case 45: // (0x2d) aload_3
  stack.push(locals[3]);
  break;
case 46: // (0x2e) iaload
case 47: // (0x2f) laload
case 48: // (0x30) faload
case 49: // (0x31) daload
case 50: // (0x32) aaload
case 51: // (0x33) baload
case 52: // (0x34) caload
case 53: // (0x35) saload
  var index = stack.pop();
  var arrayref = stack.pop();
  validateArrayrefAndIndex(arrayref, index);
  stack.push(arrayref[index.value]);
  break;
case 54: // (0x36) istore
case 55: // (0x37) lstore
case 56: // (0x38) fstore
case 57: // (0x39) dstore
case 58: // (0x3a) astore
  var index;
  if (wideFound) {
    wideFound = false;
    index = (bytecode[pc] << 8) | bytecode[pc + 1];
    pc += 2;
  } else {
    index = bytecode[pc++];
  }
  locals[index] = convertForStore(stack.pop(), locals[index]);
  break;
case 59: // (0x3b) istore_0
case 63: // (0x3f) lstore_0
case 67: // (0x43) fstore_0
case 71: // (0x47) dstore_0
case 75: // (0x4b) astore_0
  locals[0] = convertForStore(stack.pop(), locals[0]);
  break;
case 60: // (0x3c) istore_1
case 64: // (0x40) lstore_1
case 68: // (0x44) fstore_1
case 72: // (0x48) dstore_1
case 76: // (0x4c) astore_1
  locals[1] = convertForStore(stack.pop(), locals[1]);
  break;
case 61: // (0x3d) istore_2
case 65: // (0x41) lstore_2
case 69: // (0x45) fstore_2
case 73: // (0x49) dstore_2
case 77: // (0x4d) astore_2
  locals[2] = convertForStore(stack.pop(), locals[2]);
  break;
case 62: // (0x3e) istore_3
case 66: // (0x42) lstore_3
case 70: // (0x46) fstore_3
case 74: // (0x4a) dstore_3
case 78: // (0x4e) astore_3
  locals[3] = convertForStore(stack.pop(), locals[3]);
  break;
case 79: // (0x4f) iastore
case 80: // (0x50) lastore
case 81: // (0x51) fastore
case 82: // (0x52) dastore
case 83: // (0x53) aastore
case 84: // (0x54) bastore
case 85: // (0x55) castore
case 86: // (0x56) sastore
  var value = stack.pop();
  var index = stack.pop();
  var arrayref = stack.pop();
  validateArrayrefAndIndex(arrayref, index);
  arrayref[index.value] = convertForStore(value, arrayref[index.value]);
  break;
case 87: // (0x57) pop
  stack.pop();
  break;
case 88: // (0x58) pop2
  if (getValueCategory(stack.pop()) === 1) {
    stack.pop();
  }
  break;
case 89: // (0x59) dup
  var value = stack.pop();
  stack.push(value);
  stack.push(value);
  break;
case 90: // (0x5a) dup_x1
  var value1 = stack.pop();
  var value2 = stack.pop();
  stack.push(value1);
  stack.push(value2);
  stack.push(value1);
  break;
case 91: // (0x5b) dup_x2
  var value1 = stack.pop();
  var value2 = stack.pop();
  if (getValueCategory(value1) === 1) {
    var value3 = stack.pop();
    stack.push(value1);
    stack.push(value3);
    stack.push(value2);
    stack.push(value1);
  } else {
    stack.push(value1);
    stack.push(value2);
    stack.push(value1);
  }
  break;
case 92: // (0x5c) dup2
  var value1 = stack.pop();
  if (getValueCategory(value1) === 1) {
    var value2 = stack.pop();
    stack.push(value2);
    stack.push(value1);
    stack.push(value2);
    stack.push(value1);
  } else {
    stack.push(value1);
    stack.push(value1);
  }
  break;
case 93: // (0x5d) dup2_x1
  var value1 = stack.pop();
  var value2 = stack.pop();
  if (getValueCategory(value1) === 1) {
    var value3 = stack.pop();
    stack.push(value2);
    stack.push(value1);
    stack.push(value3);
    stack.push(value2);
    stack.push(value1);
  } else {
    stack.push(value1);
    stack.push(value2);
    stack.push(value1);
  }
  break;
case 94: // (0x5e) dup2_x2
  var value1 = stack.pop();
  var value2 = stack.pop();
  if (getValueCategory(value1) === 1) {
    var value3 = stack.pop();
    if(getValueCategory(value3) === 1) {
      var value4 = stack.pop();
      // form 1
      stack.push(value2);
      stack.push(value1);
      stack.push(value4);
      stack.push(value3);
      stack.push(value2);
      stack.push(value1);
    } else  {
      // form 3
      stack.push(value2);
      stack.push(value1);
      stack.push(value3);
      stack.push(value2);
      stack.push(value1);
    }
  } else {
    if(getValueCategory(value2) === 1) {
      var value3 = stack.pop();
      // form 2
      stack.push(value1);
      stack.push(value3);
      stack.push(value2);
      stack.push(value1);
    } else  {
      // form 4
      stack.push(value1);
      stack.push(value2);
      stack.push(value1);
    }
  }
  break;
case 95: // (0x5f) swap
  var value1 = stack.pop();
  var value2 = stack.pop();
  stack.push(value1);
  stack.push(value2);
  break;
case 96: // (0x60) iadd
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = (value1.value + value2.value) | 0;
  stack.push({value: resultValue, type: "I"});
  break;  
case 97: // (0x61) ladd
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value.add(value2.value);
  stack.push({value: resultValue, type: "J"});
  break;  
case 98: // (0x62) fadd
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value + value2.value;
  stack.push({value: resultValue, type: "F"});
  break;  
case 99: // (0x63) dadd
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value + value2.value;
  stack.push({value: resultValue, type: "D"});
  break;  
case 100: // (0x64) isub
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = (value1.value - value2.value) | 0;
  stack.push({value: resultValue, type: "I"});
  break;  
case 101: // (0x65) lsub
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value.sub(value2.value);
  stack.push({value: resultValue, type: "J"});
  break;  
case 102: // (0x66) fsub
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value - value2.value;
  stack.push({value: resultValue, type: "F"});
  break;  
case 103: // (0x67) dsub
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value - value2.value;
  stack.push({value: resultValue, type: "D"});
  break;  
case 104: // (0x68) imul
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = (value1.value * value2.value) | 0;
  stack.push({value: resultValue, type: "I"});
  break;  
case 105: // (0x69) lmul
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value.mul(value2.value);
  stack.push({value: resultValue, type: "J"});
  break;  
case 106: // (0x6a) fmul
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value * value2.value;
  stack.push({value: resultValue, type: "F"});
  break;  
case 107: // (0x6b) dmul
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value * value2.value;
  stack.push({value: resultValue, type: "D"});
  break;  
case 108: // (0x6c) idiv
  var value2 = stack.pop();
  var value1 = stack.pop();
  if (value2.value === 0) raiseException("java/lang/ArithmeticException");
  var resultValue = (value1.value / value2.value) | 0;
  stack.push({value: resultValue, type: "I"});
  break;  
case 109: // (0x6d) ldiv
  var value2 = stack.pop();
  var value1 = stack.pop();
  if (value2.value.cmp(LongValue.Zero) === 0) raiseException("java/lang/ArithmeticException");
  var resultValue = value1.value.div(value2.value);
  stack.push({value: resultValue, type: "J"});
  break;  
case 110: // (0x6e) fdiv
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value / value2.value;
  stack.push({value: resultValue, type: "F"});
  break;  
case 111: // (0x6f) ddiv
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value / value2.value;
  stack.push({value: resultValue, type: "D"});
  break;  
case 112: // (0x70) irem
  var value2 = stack.pop();
  var value1 = stack.pop();
  if (value2.value === 0) raiseException("java/lang/ArithmeticException");
  var resultValue = value1.value - ((value1.value / value2.value) | 0) * value2.value;
  stack.push({value: resultValue, type: "I"});
  break;  
case 113: // (0x71) lrem
  var value2 = stack.pop();
  var value1 = stack.pop();
  if (value2.value.cmp(LongValue.Zero) === 0) raiseException("java/lang/ArithmeticException");
  var resultValue = value1.value.rem(value2.value);
  stack.push({value: resultValue, type: "J"});
  break;  
case 114: // (0x72) frem
  var value2 = stack.pop();
  var value1 = stack.pop();
  if (value2.value === 0 || isNaN(value2.value)) {
    stack.push({value: NaN, type: "F"});
  } else {
    var resultValue = value1.value - Math.floor(value1.value / value2.value) * value2.value;
    stack.push({value: resultValue, type: "F"});
  }
  break;  
case 115: // (0x73) drem
  var value2 = stack.pop();
  var value1 = stack.pop();
  if (value2.value === 0 || isNaN(value2.value)) {
    stack.push({value: NaN, type: "D"});
  } else {
    var resultValue = value1.value - Math.floor(value1.value / value2.value) * value2.value;
    stack.push({value: resultValue, type: "D"});
  }
  break;  
case 116: // (0x74) ineg
  var value = stack.pop();
  var resultValue = (-value2.value) | 0;
  stack.push({value: resultValue, type: "I"});
  break;  
case 117: // (0x75) lneg
  var value = stack.pop();
  var resultValue = value2.value.neg();
  stack.push({value: resultValue, type: "J"});
  break;  
case 118: // (0x76) fneg
  var value = stack.pop();
  var resultValue = -value2.value;
  stack.push({value: resultValue, type: "F"});
  break;  
case 119: // (0x77) dneg
  var value = stack.pop();
  var resultValue = -value2.value;
  stack.push({value: resultValue, type: "D"});
  break;  
case 120: // (0x78) ishl
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = (value1.value << (value2.value & 0x3F));
  stack.push({value: resultValue, type: "I"});
  break;  
case 121: // (0x79) lshl
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value.shl(value2.value & 0x3F);
  stack.push({value: resultValue, type: "J"});
  break;  
case 122: // (0x7a) ishr
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = (value1.value >> (value2.value & 0x3F));
  stack.push({value: resultValue, type: "I"});
  break;  
case 123: // (0x7b) lshr
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value.shr(value2.value & 0x3F);
  stack.push({value: resultValue, type: "J"});
  break;  
case 124: // (0x7c) iushr
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = (value1.value >>> (value2.value & 0x3F));
  stack.push({value: resultValue, type: "I"});
  break;  
case 125: // (0x7d) lushr
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value.ushr(value2.value & 0x3F);
  stack.push({value: resultValue, type: "J"});
  break;  
case 126: // (0x7e) iand
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = (value1.value & value2.value);
  stack.push({value: resultValue, type: "I"});
  break;  
case 127: // (0x7f) land
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value.and(value2.value);
  stack.push({value: resultValue, type: "J"});
  break;  
case 128: // (0x80) ior
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = (value1.value | value2.value);
  stack.push({value: resultValue, type: "I"});
  break;  
case 129: // (0x81) lor
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value.or(value2.value);
  stack.push({value: resultValue, type: "J"});
  break;  
case 130: // (0x82) ixor
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = (value1.value ^ value2.value);
  stack.push({value: resultValue, type: "I"});
  break;  
case 131: // (0x83) lxor
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value.xor(value2.value);
  stack.push({value: resultValue, type: "J"});
  break;  
case 132: // (0x84) iinc
  var index, const_;
  if (wideFound) {
    wideFound = false;
    index = (bytecode[pc] << 8) | bytecode[pc + 1];
    const_ = (bytecode[pc + 2] << 8) | bytecode[pc + 3];
    pc += 4;
    if (const_ >= 0x8000) { const_ -= 0x10000; }
  } else {
    index = bytecode[pc++];
    const_ = bytecode[pc++];
    if (const_ >= 0x80) { const_ -= 0x100; }
  }
  locals[index].value = (locals[index].value + const_) | 0;
  break;
case 133: // (0x85) i2l
  var value = stack.pop();
  var sign = ((value.value >> 31) & 1) === 0 ? 0 : 0xFF;
  var resultValue = new LongValue([sign,sign,sign,sign, 
    (value.value >> 24) & 0xFF, (value.value >> 16) & 0xFF,
    (value.value >> 8) & 0xFF, value.value & 0xFF]);
  stack.push({value: resultValue, type: "J"});
  break;  
case 134: // (0x86) i2f
case 144: // (0x90) d2f
  var value = stack.pop();
  stack.push({value: value, type: "F"});
  break;  
case 135: // (0x87) i2d
case 141: // (0x8d) f2d
  var value = stack.pop();
  stack.push({value: value, type: "D"});
  break;  
case 136: // (0x88) l2i
  var value = stack.pop(), bytes = value.value.bytes;
  var resultValue = (bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
  stack.push({value: resultValue, type: "I"});
  break; 
case 139: // (0x8b) f2i
case 142: // (0x8e) d2i
  var value = stack.pop();
  var resultValue = (value.value | 0);
  stack.push({value: resultValue, type: "I"});
  break;
case 137: // (0x89) l2f
case 138: // (0x8a) l2d
  var value = stack.pop(); 
  var resultValue = value.value.toNumeric();
  stack.push({value: resultValue, type: op === 137 ? "F" : "D" });
  break;
case 140: // (0x8c) f2l
case 143: // (0x8f) d2l
  var value = stack.pop();
  var resultValue = LongValue.fromNumeric(value.value);
  stack.push({value: resultValue, type: "J" });
  break;  
case 145: // (0x91) i2b
  var value = stack.pop();
  var resultValue = value.value & 0xFF;
  stack.push({value: resultValue, type: "B" });
  break;  
case 146: // (0x92) i2c
  var value = stack.pop();
  var resultValue = value.value & 0xFFFF;
  stack.push({value: resultValue, type: "C" });
  break;  
case 147: // (0x93) i2s
  var value = stack.pop();
  var resultValue = value.value & 0xFFFF;
  if ((resultValue & 0x8000) !== 0) { resultValue -= 0x10000; }
  stack.push({value: resultValue, type: "S" });
  break;  
case 148: // (0x94) lcmp
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = value1.value.cmp(value2.value);
  stack.push({value: resultValue, type: "I" });
  break;
case 149: // (0x95) fcmpl
case 150: // (0x96) fcmpg
case 151: // (0x97) dcmpl
case 152: // (0x98) dcmpg
  var value2 = stack.pop();
  var value1 = stack.pop();
  var resultValue = isNaN(value1.value) || isNaN(value2.value) ?
    ((op === 149 || op === 151) ? -1 : 1) :
    value1.value == value2.value ? 0 :
    value1.value < value2.value ? -1 : 1;
  stack.push({value: resultValue, type: "I" });
  break;
case 153: // (0x99) ifeq
case 154: // (0x9a) ifne
case 155: // (0x9b) iflt
case 156: // (0x9c) ifge
case 157: // (0x9d) ifgt
case 158: // (0x9e) ifle
  var value = stack.pop();
  var branch = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  if (
    (op === 153 && value.value == 0) ||
    (op === 154 && value.value != 0) ||
    (op === 155 && value.value < 0) ||
    (op === 156 && value.value >= 0) ||
    (op === 157 && value.value > 0) ||
    (op === 158 && value.value <= 0)) {
    if (branch >= 0x8000) {
      jumpToAddress = pc + branch - 0x10003;
    } else {
      jumpToAddress = pc + branch - 3;
    }
  }
  break;
case 159: // (0x9f) if_icmpeq
case 160: // (0xa0) if_icmpne
case 161: // (0xa1) if_icmplt
case 162: // (0xa2) if_icmpge
case 163: // (0xa3) if_icmpgt
case 164: // (0xa4) if_icmple
  var value2 = stack.pop();
  var value1 = stack.pop();
  var branch = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  if (
    (op === 159 && value1.value == value2.value) ||
    (op === 160 && value1.value != value2.value) ||
    (op === 161 && value1.value < value2.value) ||
    (op === 162 && value1.value >= value2.value) ||
    (op === 163 && value1.value > value2.value) ||
    (op === 164 && value1.value <= value2.value)) {
    if (branch >= 0x8000) {
      jumpToAddress = pc + branch - 0x10003;
    } else {
      jumpToAddress = pc + branch - 3;
    }
  }
  break;
case 165: // (0xa5) if_acmpeq
case 166: // (0xa6) if_acmpne
  var value2 = stack.pop();
  var value1 = stack.pop();
  var branch = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  if (
    (op === 165 && value1 === value2) ||
    (op === 166 && value1 !== value2)) {
    if (branch >= 0x8000) {
      jumpToAddress = pc + branch - 0x10003;
    } else {
      jumpToAddress = pc + branch - 3;
    }
  }
  break;
case 167: // (0xa7) goto
  var branch = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  if (branch >= 0x8000) {
    jumpToAddress = pc + branch - 0x10003;
  } else {
    jumpToAddress = pc + branch - 3;
  }
  break;
case 168: // (0xa8) jsr
  var branch = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var returnAddress;
  if (branch >= 0x8000) {
    returnAddress = pc + branch - 0x10003;
  } else {
    returnAddress = pc + branch - 3;
  }
  stack.push({returnAddress: returnAddress});
  break;
case 169: // (0xa9) ret
  var index;
  if (wideFound) {
    wideFound = false;
    index = (bytecode[pc] << 8) | bytecode[pc + 1];
    pc += 2;
  } else {
    index = bytecode[pc++];
  }
  jumpToAddress = locals[index].returnAddress;
  break;
case 170: // (0xaa) tableswitch
  var padding = pc % 4, tableswitchAddress = pc - 1;
  pc += padding;
  var index = stack.pop();
  var defaultOffset = (bytecode[pc] << 24) | (bytecode[pc + 1] << 16) | (bytecode[pc + 2] << 8) | bytecode[pc + 3];
  var lowValue = (bytecode[pc + 4] << 24) | (bytecode[pc + 5] << 16) | (bytecode[pc + 6] << 8) | bytecode[pc + 7];
  var highValue = (bytecode[pc + 8] << 24) | (bytecode[pc + 9] << 16) | (bytecode[pc + 10] << 8) | bytecode[pc + 11];
  if (index.value < lowValue || index.value > highValue) {
    jumpToAddress = tableswitchAddress + defaultOffset;
  } else {
    var i = (index.value - lowValue) << 2 + pc + 12;
    var offset = (bytecode[i] << 24) | (bytecode[i + 1] << 16) | (bytecode[i + 2] << 8) | bytecode[i + 3];
    jumpToAddress = tableswitchAddress + offset;    
  }
  break;
case 171: // (0xab) lookupswitch
  var padding = pc % 4, lookupswitchAddress = pc - 1;
  pc += padding;
  var key = stack.pop();
  var defaultOffset = (bytecode[pc] << 24) | (bytecode[pc + 1] << 16) | (bytecode[pc + 2] << 8) | bytecode[pc + 3];
  var npairs = (bytecode[pc + 4] << 24) | (bytecode[pc + 5] << 16) | (bytecode[pc + 6] << 8) | bytecode[pc + 7];
  pc += 8;
  var offset = defaultOffset;
  for (var i = 0; i < npairs; ++i) {    
    var pairKey = (bytecode[pc] << 24) | (bytecode[pc + 1] << 16) | (bytecode[pc + 2] << 8) | bytecode[pc + 3];
    if (pairKey == key.value) {
      offset = (bytecode[pc + 4] << 24) | (bytecode[pc + 5] << 16) | (bytecode[pc + 6] << 8) | bytecode[pc + 7];
      break;
    }
    pc += 8;
  }
  jumpToAddress = tableswitchAddress + offset;
  break;
case 172: // (0xac) ireturn
case 173: // (0xad) lreturn
case 174: // (0xae) freturn
case 175: // (0xaf) dreturn
case 176: // (0xb0) areturn
case 177: // (0xb1) return
  return false;
case 178: // (0xb2) getstatic
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  resultValue = runtime.getstatic(constant_pool[index]);
  stack.push(resultValue);
  break;
case 179: // (0xb3) putstatic
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var value = stack.pop();
  runtime.putstatic(constant_pool[index], value);
  break;
case 180: // (0xb4) getfield
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var objectref = stack.pop();
  validateNonNull(objectref);
  var resultValue = runtime.getfield(objectref, constant_pool[index]);
  stack.push(resultValue);
  break;
case 181: // (0xb5) putfield
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var value = stack.pop();
  var objectref = stack.pop();
  validateNonNull(objectref);
  runtime.putfield(objectref, constant_pool[index], value);
  break;
case 182: // (0xb6) invokevirtual
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var args = [], args_count = getArgumentsCountFromDescriptor(constant_pool[index].name_and_type.descriptor);
  for (var i = 0; i < args_count; ++i) {
    args.unshift(stack.pop());
  }
  var objectref = stack.pop();
  validateNonNull(objectref);
  var resultValue = runtime.invokevirtual(objectref, constant_pool[index], args);
  if (hasReturnValueFromDescriptor(constant_pool[index].name_and_type.descriptor)) {
    stack.push(resultValue);
  }
  break;
case 183: // (0xb7) invokespecial
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var args = [], args_count = getArgumentsCountFromDescriptor(constant_pool[index].name_and_type.descriptor);
  for (var i = 0; i < args_count; ++i) {
    args.unshift(stack.pop());
  }
  var objectref = stack.pop();
  validateNonNull(objectref);
  var resultValue = runtime.invokespecial(objectref, constant_pool[index], args);
  if (hasReturnValueFromDescriptor(constant_pool[index].name_and_type.descriptor)) {
    stack.push(resultValue);
  }
  break;
case 184: // (0xb8) invokestatic
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var args = [], args_count = getArgumentsCountFromDescriptor(constant_pool[index].name_and_type.descriptor);
  for (var i = 0; i < args_count; ++i) {
    args.unshift(stack.pop());
  }
  var resultValue = runtime.invokestatic(constant_pool[index], args);
  if (hasReturnValueFromDescriptor(constant_pool[index].name_and_type.descriptor)) {
    stack.push(resultValue);
  }
  break;
case 185: // (0xb9) invokeinterface
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 4;
  var args = [], args_count = getArgumentsCountFromDescriptor(constant_pool[index].name_and_type.descriptor);
  for (var i = 0; i < args_count; ++i) {
    args.unshift(stack.pop());
  }
  var objectref = stack.pop();
  validateNonNull(objectref);
  var resultValue = runtime.invokeinterface(objectref, constant_pool[index], args);
  if (hasReturnValueFromDescriptor(constant_pool[index].name_and_type.descriptor)) {
    stack.push(resultValue);
  }
  break;
case 187: // (0xbb) new
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var resultValue = runtime.new_(constant_pool[index]);
  stack.push(resultValue);
  break;
case 188: // (0xbc) newarray
  var atype = bytecode[pc++];
  var count = stack.pop();
  stack.push(createArray(count, atype));
  break;
case 189: // (0xbd) anewarray
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var count = stack.pop();
  stack.push(createAArray([count], constant_pool[index]));
  break;
case 190: // (0xbe) arraylength
  var arrayref = stack.pop();
  validateArrayref(arrayref);
  stack.push({value: arrayref.length, type: "I" });
  break;
case 191: // (0xbf) athrow
  var objectref = stack.pop();
  validateNonNull(objectref);
  throw new MethodExecutionException("Code exception",objectref);
  //processThrow(objectref);
  break;
case 192: // (0xc0) checkcast
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var objectref = stack.pop();
  checkCast(objectref, constant_pool[index]);
  stack.push(objectref);
  break;
case 193: // (0xc1) instanceof
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  var objectref = stack.pop();
  var resultValue = instanceOf(objectref, constant_pool[index]);
  stack.push({value: resultValue, type: "I"});
  break;
case 194: // (0xc2) monitorenter
  var objectref = stack.pop();
  validateNonNull(objectref);
  monitorEnter(objectref);
  break;
case 195: // (0xc3) monitorexit
  var objectref = stack.pop();
  validateNonNull(objectref);
  monitorExit(objectref);
  break;
case 196: // (0xc4) wide
  wideFound = true;
  break;
case 197: // (0xc5) multianewarray
  var index = (bytecode[pc] << 8) | bytecode[pc + 1];
  var dimensions = bytecode[pc + 3];
  pc += 3;
  var counts = [];
  for (var i = 0; i < dimensions; ++i) {
    counts.unshift(stack.pop());
  }
  stack.push(createAArray(counts, constant_pool[index]));
  break;
case 198: // (0xc6) ifnull
case 199: // (0xc7) ifnonnull
  var value = stack.pop();
  var branch = (bytecode[pc] << 8) | bytecode[pc + 1];
  pc += 2;
  if ( (op === 198) === (value == null) ) {
    if (branch >= 0x8000) {
      jumpToAddress = pc + branch - 0x10003;
    } else {
      jumpToAddress = pc + branch - 3;
    }
  }
  break;
case 200: // (0xc8) goto_w
  var branch = (bytecode[pc] << 24) | (bytecode[pc + 1] << 16) | (bytecode[pc + 2] << 8) | bytecode[pc + 3];
  jumpToAddress = pc - 3 + branch;
  break;
case 201: // (0xc9) jsr_w
  var branch = (bytecode[pc] << 24) | (bytecode[pc + 1] << 16) | (bytecode[pc + 2] << 8) | bytecode[pc + 3];
  var returnAddress = pc - 3 + branch;
  stack.push({returnAddress: returnAddress});
  break;

case 186: // (0xba) xxxunusedxxx1
case 202: // (0xca) breakpoint
case 254: // (0xfe) impdep1
case 255: // (0xff) impdep2
default:
  throw "invalid operation " + op + " @" + pc;
}

		if (jumpToAddress !== null) {
			pc = jumpToAddress;
		}
		return true;
	} catch (e){
		if (e instanceof MethodExecutionException){
			processThrow(e);
		} else {
			throw e;
		}
	}
  };
}
var natives = {};
function getNative(className, methodName) {
	var jniFunc = "Java_"+className.replace(/\//g, "_") + "_" + methodName;
	if (jniFunc in natives) {
		return natives[jniFunc];
	} else {
		return null;
	}
}

var factories = {};

function getFactory(className) {
  if (className in factories) {
    return factories[className];
  }

  //try {
    var searchLocations = ["."];
    if (getFactory.searchLocations) {
      searchLocations = getFactory.searchLocations;
    }
    var data, filePath = className.replace(/\./g, "/") + ".class";
    for (var i = 0; i < searchLocations.length; ++i) {
      if (typeof searchLocations[i] === "object") {
        if (!searchLocations[i].hasOwnProperty(filePath)) {
          continue;
        }
        data = searchLocations[i][filePath];
        break;
      }

      try {
        var resourceUrl = searchLocations[i] + "/" + filePath;
        data = loadFile(resourceUrl);
		if (data != null) {
			log("Class " + className + " was found at " + resourceUrl + "\n");
			break;
		}
      } catch(ex) {
        // failed, trying again
      }
    }
    if (!data) {
      throw "Class " + className + " was not found";
    }

    var classFile = parseJavaClass(data);
    var factory = new ClassFactory(classFile);

    factories[className] = factory;

	if (className != "java/lang/Object") {
		factory.superFactory = getFactory(classFile.super_class.name);
	}
    if ("<clinit>()V" in factory.statics) {
      factory.statics["<clinit>()V"]();
    }

  return factory;
}

function ClassFactory(classFile) {
  this.classFile = classFile;
  this.className = classFile.this_class.name;

  var factory = this;

  function create() {
    var obj = {};
    for (var i = 0, l = classFile.fields.length; i < l; ++i) {
      obj[classFile.fields[i].name] = 0;
    }
    for (var i = 0, l = classFile.methods.length; i < l; ++i) {
      if (("ACC_STATIC" in classFile.methods[i].access_flags)) { continue; }
      (function(method) {
		var fullMethodName = method.name+method.descriptor;
        obj[fullMethodName] = function() {
			var vm = new MethodProxy(classFile.this_class.name, method, classFile.constant_pool, obj, arguments);
			//console.log("class: "+classFile.this_class.name+" , method: "+method.name);
		try {
			return vm.execute();
		} catch (e) {
			console.trace(e);
			throw e;
		}
        };
      })(classFile.methods[i]);
    }
    return obj;
  }  
  
  // TODO intefaces static methods
  var statics = {};
  for (var i = 0, l = classFile.methods.length; i < l; ++i) {
    if (!("ACC_STATIC" in classFile.methods[i].access_flags)) { continue; }
    (function(method) {
		var fullMethodName = method.name+method.descriptor;
      statics[fullMethodName] = function() {
        var vm = new MethodProxy(classFile.this_class.name, method, classFile.constant_pool, null, arguments);
		console.log("class: "+classFile.this_class.name+" , method: "+method.name);
		try {
			return vm.execute();
		} catch (e) {
			console.trace(e);
			if (e instanceof MethodExecutionException){
				var fullMethodName = method.name+method.descriptor;
				if (fullMethodName == "main([Ljava/lang/String;)V") {
					var objref = e.nativeException;
					objref['printStackTrace()V'].apply(objref, []);
				} else {		
					throw e;
				}
			} else {
				throw e;
			}
		}
			
		};
    })(classFile.methods[i]);
  }
  var staticsFields = [];
  for (var i = 0, l = classFile.fields.length; i < l; ++i) {
    if (!("ACC_STATIC" in classFile.fields[i].access_flags)) { continue; }
		staticsFields.push(classFile.fields[i].name);			
  }

  var methods = [], fields = [], interfaces = [];
  for (var i = 0, l = classFile.methods.length; i < l; ++i) {
    if (("ACC_STATIC" in classFile.methods[i].access_flags) || ("ACC_PRIVATE" in classFile.methods[i].access_flags)) { continue; }
    methods.push(classFile.methods[i].name+classFile.methods[i].descriptor);
  }    
  for (var i = 0, l = classFile.fields.length; i < l; ++i) {
    if (("ACC_STATIC" in classFile.fields[i].access_flags) || ("ACC_PRIVATE" in classFile.fields[i].access_flags)) { continue; }
    fields.push(classFile.fields[i].name);
  }    

  this.staticsFields = staticsFields;
  this.statics = statics;
  this.create = create;
  this.instanceMethods = methods;
  this.instanceFields = fields;
  this.interfaces = interfaces;
}

function MethodExecutionException(message, nativeException) {
  this.message = message;
  this.nativeException = nativeException;
}
MethodExecutionException.prototype.toString = function() {
  return this.message;
}

function normalizeObject(object, className) {
  if (typeof object === "object") {
    if (!("$self" in object)) {
      return object;
    }
    if (object.$factory.className === className) {
      return object;
    }
    var self = object.$self;
    while (self != null) {
      if (self.$factory.className === className) {
        return self;
      }
      self = self.$super;
    }
    return object;
  }
  if (typeof object === "string") {
    object = new JavaString(object);
    return className === "java/lang/Object" ? object.$super : object;
  }
  return object;
}

function buildVirtualTable(object) {
  function proxyMethod(name) {
    object[name] = function() {
      return object.$super[name].apply(object.$super, arguments);
    };
  }

  function proxyField(name) {
    Object.defineProperty(object, name, {
      get: function() {
        return object.$super[name];
      },
      set: function(value) {
        object.$super[name] = value;
      }
    });
  }

  var meta = { methods: [], fields: [] };
  if (object.$super) { 
    meta = buildVirtualTable(object.$super);
    for (var i = 0, l = meta.methods.length; i < l; ++i) {
      if (object.hasOwnProperty(meta.methods[i])) { continue; }
      proxyMethod(meta.methods[i]);
    }
    for (var i = 0, l = meta.fields.length; i < l; ++i) {
      if (object.hasOwnProperty(meta.fields[i])) { continue; }
      proxyField(meta.fields[i]);
    }
  }  
  if (object.$factory.instanceMethods) {
    meta.methods = meta.methods.concat(object.$factory.instanceMethods);
  }
  if (object.$factory.instanceFields) {
    meta.fields = meta.fields.concat(object.$factory.instanceFields);
  }
  return meta;
}

runtime = {
  getstatic: function(field) {
    var factory = getFactory(field.class_.name);
    if (!(field.name_and_type.name in factory.staticsFields)) {
      throw "Static field " + field.class_.name + ":" + field.name_and_type.name + " not found";
    }
    return factory.staticsFields[field.name_and_type.name];
  },
  putstatic: function(field, value) {
    var factory = getFactory(field.class_.name);
    factory.staticsFields[field.name_and_type.name] = value;
  },
  getfield: function(object, field) {
    object = normalizeObject(object, field.class_.name);
    if (!(field.name_and_type.name in object)) {
      throw "Field " + field.class_.name + ":" + field.name_and_type.name + " not found";
    }
    return object[field.name_and_type.name];
  },
  putfield: function(object, field, value) {
    object = normalizeObject(object, field.class_.name);
    object[field.name_and_type.name] = value;
  },
  instanceof_: function(object, class_) {
    if (object == null) {
      return true;
    }
    object = normalizeObject(object, class_.name);
    return object.$factory.className === class_.name;
  },
  invokestatic: function(method, args) {
    var factory = getFactory(method.class_.name);
	var fullMethodName = method.name_and_type.name+method.name_and_type.descriptor;
    if (!(fullMethodName in factory.statics)) {
      throw "Static method " + method.class_.name + ":" + method.name_and_type.name + " not found";
    }
    return factory.statics[fullMethodName].apply(null, args);
  },
  invokespecial: function(object, method, args) {
    object = normalizeObject(object, method.class_.name);
	var fullMethodName = method.name_and_type.name+method.name_and_type.descriptor;
    if (!(fullMethodName in object)) {
      throw "Special method " + method.class_.name + ":" + method.name_and_type.name + " not found";
    }
    var result = object[fullMethodName].apply(object, args);
    return result;
  },
  invokevirtual: function(object, method, args) {
    var object = "$self" in object ? object.$self : object;
	var fullMethodName = method.name_and_type.name+method.name_and_type.descriptor;
    if (!(fullMethodName in object)) {
      throw "Method " + method.class_.name + ":" + method.name_and_type.name + " not found";
    }
    return object[fullMethodName].apply(object, args);
  },
  invokeinterface: function(object, method, args) {
    var object = "$self" in object ? object.$self : object;
	var fullMethodName = method.name_and_type.name+method.name_and_type.descriptor;
    if (!(fullMethodName in object)) {
      throw "Interface method " + method.class_.name + ":" + method.name_and_type.name + " not found";
    }
    return object[fullMethodName].apply(object, args);
  },
  new_: function(class_) {
    var factory = getFactory(class_.name);
    var object = factory.create();
    object.$factory = factory;
    object.$self = object;
    var sf, prev = object;
    for (sf = factory.superFactory; sf; sf = sf.superFactory) {
      var super_ = sf.create();
      super_.$factory = sf;
      prev.$super = super_;
      super_.$upcast = prev;
      super_.$self = object;
      prev = super_;
    }
    buildVirtualTable(object);
    return object;
  },
  newexception: function(typeName) {
    var object = this.new_({name: typeName});
    this.invokespecial(object, {class_:typeName, name_and_type: {name: "<init>", descriptor: "()V"}}, []);
    return object;
  }
};

var jvm_instr = ['nop','aconst_null','iconst_m1','iconst_0','iconst_1','iconst_2','iconst_3','iconst_4','iconst_5','lconst_0','lconst_1','fconst_0','fconst_1','fconst_2','dconst_0','dconst_1','bipush','sipush','ldc','ldc_w','ldc2_w','iload','lload','fload','dload','aload','iload_0','iload_1','iload_2','iload_3','lload_0','lload_1','lload_2','lload_3','fload_0','fload_1','fload_2','fload_3','dload_0','dload_1','dload_2','dload_3','aload_0','aload_1','aload_2','aload_3','iaload','laload','faload','daload','aaload','baload','caload','saload','istore','lstore','fstore','dstore','astore','istore_0','istore_1','istore_2','istore_3','lstore_0','lstore_1','lstore_2','lstore_3','fstore_0','fstore_1','fstore_2','fstore_3','dstore_0','dstore_1','dstore_2','dstore_3','astore_0','astore_1','astore_2','astore_3','iastore','lastore','fastore','dastore','aastore','bastore','castore','sastore','pop','pop2','dup','dup_x1','dup_x2','dup2','dup2_x1','dup2_x2','swap','iadd','ladd','fadd','dadd','isub','lsub','fsub','dsub','imul','lmul','fmul','dmul','idiv','ldiv','fdiv','ddiv','irem','lrem','frem','drem','ineg','lneg','fneg','dneg','ishl','lshl','ishr','lshr','iushr','lushr','iand','land','ior','lor','ixor','lxor','iinc','i2l','i2f','i2d','l2i','l2f','l2d','f2i','f2l','f2d','d2i','d2l','d2f','i2b','i2c','i2s','lcmp','fcmpl','fcmpg','dcmpl','dcmpg','ifeq','ifne','iflt','ifge','ifgt','ifle','if_icmpeq','if_icmpne','if_icmplt','if_icmpge','if_icmpgt','if_icmple','if_acmpeq','if_acmpne','goto','jsr','ret','tableswitch','lookupswitch','ireturn','lreturn','freturn','dreturn','areturn','return','getstatic','putstatic','getfield','putfield','invokevirtual','invokespecial','invokestatic','invokeinterface','xxxunusedxxx1','new','newarray','anewarray','arraylength','athrow','checkcast','instanceof','monitorenter','monitorexit','wide','multianewarray','ifnull','ifnonnull','goto_w','jsr_w','breakpoint'];
