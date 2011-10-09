function addNative(description) {  
  natives[description.name] = description.exec;
}
addNative({
  name: "Java_java_lang_Class_registerNatives",
  exec: function() {
	//throw new Exception("Not implemented registerNatives" );
  }
});
addNative({
  name: "Java_java_lang_Object_registerNatives",
  exec: function() {
	//throw new Exception("Not implemented registerNatives" );
  }
});
addNative({
  name: "Java_java_lang_System_registerNatives",
  exec: function() {
	//throw new Exception("Not implemented registerNatives" );
  }
});
addNative({
  name: "Java_java_lang_System_currentTimeMillis",
  exec: function() {
	var currentTimeMillis = new Date().getTime();
	return {value: new LongValue(currentTimeMillis), type: "L"};
  }
});
addNative({
  name: "Java_java_lang_Throwable_fillInStackTrace",
  exec: function(env, obj) {
	console.log("Java_java_lang_Throwable_fillInStackTrace: this="+this);
	return obj;
  }
});
addNative({
  name: "Java_java_lang_Object_getClass",
  exec: function() {
	var ref = runtime.new_({name: "java/lang/Class"});
	return ref;
	//return {value: "TODO", type: "A", getName: function(){ return "";}};
  }
});
addNative({
  name: "Java_java_lang_System_getClass",
  exec: function() {
	var ref = runtime.new_({name: "java/lang/Class"});
	return ref;
	//return {value: "TODO", type: "A", getName: function(){ return "";}};
  }
});